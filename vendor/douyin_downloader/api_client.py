# Adapted subset of jiji262/douyin-downloader, MIT (c) 2026 jiji262.
# Pinned source and local modifications are documented in SOURCE.md.
from __future__ import annotations
import asyncio,time,logging
from typing import Any,Dict,List,Optional
logger=logging.getLogger("tijian.douyin.upstream")
logger.addHandler(logging.NullHandler())
logger.propagate=False
_LOGIN_REQUIRED_STATUS_CODES = {2483}

_RETRY_DELAYS_SECONDS = (1, 2, 5)

_MAX_ATTEMPTS = 3

_SERVER_ERROR_MIN_STATUS = 500

ARGUS_REJECTION_MARKER = "ArgusSecurityPlugin"

_ARGUS_REJECTION_STATUS = 403

_ERROR_BODY_LOG_CHARS = 80

class LoginRequiredError(Exception):
    """Raised when Douyin rejects a request because the session is not logged in.

    Signalled by ``status_code == 2483`` (or a ``status_msg`` asking to log in).
    Higher layers (CLI) catch this to trigger an interactive re-login + retry.
    """

    def __init__(self, status_code: int, status_msg: str, path: str):
        self.status_code = status_code
        self.status_msg = status_msg
        self.path = path
        super().__init__(f"login required (status_code={status_code}) at {path}: {status_msg}")

class FailedPayload(dict):
    """请求失败时回的空 payload,多带一条机器可读的失败原因。

    与 ``{}`` 完全等价(``not payload``、``payload == {}`` 都成立):「失败回 ``{}``」
    是几十个调用方与测试替身共同依赖的契约,不能换返回类型。只有分页 walk 读
    ``kind``,据此决定要不要整页重试、给用户什么文案。拷贝(``dict(p)`` / ``{**p}``)
    会丢掉原因,退化成普通的请求失败——只少了提示,不会误判。
    """

    # 抖音确定性拒绝:403 且 body 带 ArgusSecurityPlugin(直连或经 page bridge)。
    REJECTED = "rejected"
    # page bridge 传输失败(TIMEOUT / PAGE_LOAD_FAILED 等),``detail`` 是错误码。
    BRIDGE_ERROR = "bridge_error"

    def __init__(
        self, kind: str, *, status: int = 0, detail: str = "", via_bridge: bool = False
    ) -> None:
        super().__init__()
        self.kind = kind
        self.status = status
        self.detail = detail
        self.via_bridge = via_bridge

def _is_login_required(data: object) -> bool:
    if not isinstance(data, dict):
        return False
    code = data.get("status_code")
    msg = str(data.get("status_msg") or "")
    # Match by message, not by the bare status_code=8: `8` is a generic
    # Douyin error code, but "用户未登录" is unambiguously "not logged in"
    # (returned by /profile/self/ and other endpoints on an expired
    # session). Message-matching avoids misreading an unrelated code-8.
    return code in _LOGIN_REQUIRED_STATUS_CODES or "请先登录" in msg or "用户未登录" in msg

def _summarize_api_response(data: object) -> Dict[str, Any]:
    """Keep response-shape diagnostics without persisting item payloads."""

    raw = data if isinstance(data, dict) else {}
    item_key = "-"
    item_count: Any = 0
    # 覆盖所有 ``_normalize_paged_response`` 用到的列表键：少一个就会把「列表里
    # 有 3 条」记成 item_count=0，2026-09-16 的合集排查就因此多绕了一圈。
    for key in (
        "aweme_list",
        "items",
        "followings",
        "mix_infos",
        "mix_list",
        "series_infos",
        "music_list",
        "collects_list",
        "comments",
        "data",
    ):
        if key not in raw:
            continue
        value = raw[key]
        if isinstance(value, list):
            item_key = key
            item_count = len(value)
            break
        if value is None:
            # ``"mix_infos": null`` 与 ``[]`` 在日志里必须能分辨。
            item_key = key
            item_count = "null"
            break

    status_msg = " ".join(str(raw.get("status_msg") or "").split())[:200]
    cursor = raw.get("max_cursor")
    if cursor is None:
        cursor = raw.get("cursor")
    return {
        "api_status": raw.get("status_code"),
        "status_msg": status_msg,
        "item_key": item_key,
        "item_count": item_count,
        "has_more": raw.get("has_more"),
        "cursor": cursor,
        "login_tip": bool((raw.get("not_login_module") or {}).get("guide_login_tip_exist"))
        if isinstance(raw.get("not_login_module"), dict)
        else False,
        "verify_page": bool(raw.get("verify_ticket")),
        "top_level_keys": ",".join(sorted(str(key) for key in raw)[:30]),
    }

def _elapsed_ms(started: float) -> int:
    return max(0, int((time.monotonic() - started) * 1000))

def _is_argus_rejection(status: int, body_prefix: str) -> bool:
    return status == _ARGUS_REJECTION_STATUS and ARGUS_REJECTION_MARKER in body_prefix

def _log_api_response(
    path: str,
    attempt: int,
    max_retries: int,
    body: bytes,
    data: object,
    started: float,
) -> None:
    summary = _summarize_api_response(data)
    logger.info(
        "Douyin API response: path=%s attempt=%d/%d http=200 duration_ms=%d bytes=%d "
        "api_status=%s status_msg=%r item_key=%s item_count=%s has_more=%s cursor=%s "
        "login_tip=%s verify_page=%s keys=%s",
        path,
        attempt + 1,
        max_retries,
        _elapsed_ms(started),
        len(body),
        summary["api_status"],
        summary["status_msg"],
        summary["item_key"],
        summary["item_count"],
        summary["has_more"],
        summary["cursor"],
        summary["login_tip"],
        summary["verify_page"],
        summary["top_level_keys"],
    )

class DouyinAPIClient:
    def __init__(self,page_bridge):
        self.page_bridge=page_bridge
    async def _default_query(self):
        # The native page transport adds its real browser properties.
        return {"device_platform":"webapp","aid":"6383","channel":"channel_pc_web"}
    async def _request_json(self,*args,**kwargs):
        raise RuntimeError("Only the authenticated page transport is supported")
    def _payload_from_bridge_result(self, result: Any, path: str, started: float) -> Dict[str, Any]:
        """把 bridge 200 响应折算成与 ``_request_json`` 一致的 payload。

        body 非 dict(如反爬 HTML challenge 页)按 Non-JSON 200 记警告并降级为
        ``{}``,与 aiohttp 路径的同名日志对齐,避免把它悄悄记成成功响应。
        """
        text = str(getattr(result, "text", "") or "")
        body = getattr(result, "body", None)
        if not isinstance(body, dict):
            logger.warning(
                "Non-JSON 200 response via page bridge: path=%s text_len=%d",
                path,
                len(text),
            )
        payload = body if isinstance(body, dict) else {}
        _log_api_response(path, 0, 1, text.encode("utf-8", "replace"), payload, started)
        if _is_login_required(payload):
            raise LoginRequiredError(
                int(payload.get("status_code") or 0),
                str(payload.get("status_msg") or ""),
                path,
            )
        return payload

    async def _request_json_gated(
        self,
        path: str,
        params: Dict[str, Any],
        *,
        method: str = "GET",
        data: Optional[Dict[str, Any]] = None,
        request_headers: Optional[Dict[str, str]] = None,
        suppress_error: bool = False,
    ) -> Dict[str, Any]:
        """被 ArgusSecurityPlugin 门禁的端点入口。

        有 ``page_bridge`` 时交给 Electron 隐藏登录窗口发(页面 SDK 补
        uifid / timestamp / x-secsdk-web-signature),否则与 ``_request_json``
        完全一致。经 bridge 的 403/429 不重试:Argus 拒绝是确定性的,重试只会
        加速触发验证码。5xx 与反爬空 200 是瞬时的,与 aiohttp 路径同档重试。
        """
        if self.page_bridge is None:
            return await self._request_json(
                path,
                params,
                method=method,
                data=data,
                request_headers=request_headers,
                suppress_error=suppress_error,
            )
        started = time.monotonic()
        logger.info(
            "Douyin API request via page bridge: path=%s method=%s param_keys=%s",
            path,
            method.upper(),
            ",".join(sorted(str(key) for key in params)),
        )
        for attempt in range(_MAX_ATTEMPTS):
            result = await self._fetch_via_page_bridge(path, params, method=method, data=data)
            status = int(getattr(result, "http_status", 0) or 0)
            if not self._bridge_answer_is_transient(result, status):
                break
            logger.warning(
                "Douyin API transient failure via page bridge: path=%s attempt=%d/%d status=%s",
                path,
                attempt + 1,
                _MAX_ATTEMPTS,
                status,
            )
            if attempt == _MAX_ATTEMPTS - 1:
                break
            await asyncio.sleep(_RETRY_DELAYS_SECONDS[min(attempt, len(_RETRY_DELAYS_SECONDS) - 1)])
        if status == 200:
            return self._payload_from_bridge_result(result, path, started)
        body_prefix = str(getattr(result, "text", "") or "")[:_ERROR_BODY_LOG_CHARS]
        log_fn = logger.info if suppress_error else logger.error
        log_fn(
            "Douyin API HTTP failure via page bridge: path=%s status=%s duration_ms=%d body=%r",
            path,
            status,
            _elapsed_ms(started),
            body_prefix,
        )
        # 与直连同一判据:只有 Argus 标记是确定性拒绝;普通 403 / 429 可能只是限流,
        # 分页 walk 仍要有整页重试的机会。
        if not _is_argus_rejection(status, body_prefix):
            return {}
        return FailedPayload(
            FailedPayload.REJECTED, status=status, detail=body_prefix, via_bridge=True
        )

    async def _fetch_via_page_bridge(
        self,
        path: str,
        params: Dict[str, Any],
        *,
        method: str,
        data: Optional[Dict[str, Any]],
    ) -> Any:
        try:
            return await self.page_bridge.fetch(path, params, method=method.upper(), data=data)
        except Exception as exc:
            if getattr(exc, "page_bridge_code", None) == "NOT_LOGGED_IN":
                raise LoginRequiredError(0, "page bridge: not logged in", path) from exc
            raise

    @staticmethod
    def _bridge_answer_is_transient(result: Any, status: int) -> bool:
        """只有服务端 5xx 与「空 200」值得重试。

        403/429 是 Argus 的确定性拒绝;其余 4xx 同样不会自愈;非空但非 JSON
        的 200 是验证码/挑战页,重试只是白烧这个窗口。
        """
        if status >= _SERVER_ERROR_MIN_STATUS:
            return True
        if status != 200 or isinstance(getattr(result, "body", None), dict):
            return False
        return not str(getattr(result, "text", "") or "").strip()

    @staticmethod
    def _normalize_paged_response(
        raw_data: Any,
        *,
        item_keys: Optional[List[str]] = None,
        source: str = "api",
    ) -> Dict[str, Any]:
        raw = raw_data if isinstance(raw_data, dict) else {}
        keys = item_keys or []
        keys = ["items", *keys, "aweme_list", "mix_list", "music_list"]

        items: List[Dict[str, Any]] = []
        # 显式的 ``"aweme_list": null`` 与真 ``[]`` 归一化后都是空 items，但只有
        # 后者可信：docs/spec/gotchas.md 记着 0.11.2 把 null 当空收藏夹，清空了
        # 用户的自定义收藏夹。这里留下痕迹，让分页走查能判成失败而不是到底。
        items_missing = False
        for key in keys:
            if key not in raw:
                continue
            value = raw[key]
            if isinstance(value, list):
                items = value
                items_missing = False
                break
            items_missing = True

        has_more_value = raw.get("has_more", False)
        try:
            has_more = bool(int(has_more_value))
        except (TypeError, ValueError):
            has_more = bool(has_more_value)

        max_cursor_value = raw.get("max_cursor")
        if max_cursor_value is None:
            max_cursor_value = raw.get("cursor", 0)
        try:
            max_cursor = int(max_cursor_value or 0)
        except (TypeError, ValueError):
            max_cursor = 0

        status_code_value = raw.get("status_code", 0)
        try:
            status_code = int(status_code_value or 0)
        except (TypeError, ValueError):
            status_code = 0

        risk_flags = {
            "login_tip": bool(
                ((raw.get("not_login_module") or {}).get("guide_login_tip_exist"))
                if isinstance(raw.get("not_login_module"), dict)
                else False
            ),
            "verify_page": bool(raw.get("verify_ticket")),
        }

        normalized = {
            "items": items,
            "items_missing": items_missing,
            "aweme_list": items,  # 兼容旧调用方
            "has_more": has_more,
            "max_cursor": max_cursor,
            "status_code": status_code,
            "source": source,
            "risk_flags": risk_flags,
            "raw": raw,
        }
        for key, value in raw.items():
            if key not in normalized:
                normalized[key] = value
        return normalized

    async def _build_user_page_params(
        self, sec_uid: str, max_cursor: int, count: int
    ) -> Dict[str, Any]:
        params = await self._default_query()
        params.update(
            {
                "sec_user_id": sec_uid,
                "max_cursor": max_cursor,
                "count": count,
                "locate_query": "false",
            }
        )
        return params

    _DETAIL_AID_CANDIDATES = ("6383", "1128")

    async def get_video_detail(
        self, aweme_id: str, *, suppress_error: bool = False
    ) -> Optional[Dict[str, Any]]:
        for aid in self._DETAIL_AID_CANDIDATES:
            params = await self._default_query()
            params.update(
                {
                    "aweme_id": aweme_id,
                    "aid": aid,
                }
            )

            data = await self._request_json_gated(
                "/aweme/v1/web/aweme/detail/",
                params,
                suppress_error=(suppress_error or aid != self._DETAIL_AID_CANDIDATES[-1]),
            )
            if not data:
                continue

            detail = data.get("aweme_detail")
            if detail:
                return detail

            # API returned data but aweme_detail is null — check if content was
            # filtered (e.g. filter_reason="images_base" for note/gallery).
            filter_info = data.get("filter_detail")
            if isinstance(filter_info, dict) and filter_info.get("filter_reason"):
                logger.info(
                    "Aweme %s filtered with aid=%s (reason=%s), retrying",
                    aweme_id,
                    aid,
                    filter_info["filter_reason"],
                )
                continue

            # aweme_detail is null without a filter reason — no retry needed
            break

        return None

    async def get_user_post(
        self, sec_uid: str, max_cursor: int = 0, count: int = 18
    ) -> Dict[str, Any]:
        params = await self._build_user_page_params(sec_uid, max_cursor, count)
        params.update(
            {
                "show_live_replay_strategy": "1",
                "need_time_list": "1",
                "time_list_query": "0",
                "whale_cut_token": "",
                "cut_version": "1",
                "publish_video_strategy_type": "2",
            }
        )
        raw = await self._request_json_gated("/aweme/v1/web/aweme/post/", params)
        return self._normalize_paged_response(raw, item_keys=["aweme_list"])
