# 我的 IP 默认：Studio / PersonalIP 接入说明

此文件替代初稿的历史空值策略。Studio.tsx、PersonalIP.tsx 由主 Agent 合并，辅助 Agent 不修改这两个文件。不改后端、不 build、不打包、不 commit、不调用 live/provider。

## 统一规则

1. 历史非空 IP 原样保留；若删除，展示不可用并让用户重新选择，不静默换 IP。
2. 明确空的 choiceKey，或 origin/task.identity_skipped，保留通用表达；切页和重启保留。
3. 未标记的旧默认空 / undefined 视为未选择，默认最新用户 IP。flow.id、version、已有正文、本机缓存存在，都不能证明用户明确不使用身份。
4. 默认只作用于接下来编辑/生成的草稿输入，绝不修改历史生成记录、历史版本或已交付作品。

`latestProfileId(profiles)` 用 updated/created 较晚时间，忽略 archived，不改变数组。
`resolveProfileId(profiles,current,ready)` 中的 current 应当先经过上面规则归一：undefined 未选择、'' 明确通用、非空字符串已有身份。
`flowProfileInitial(flow,explicitChoice?)` 会保留非空 profile_id；否则检查 identity_skipped / explicitChoice；绝不看 id/version。
`taskProfileInitial(task,cached?,scope?)` 保留非空缓存/任务身份，保留 identity_skipped；未标记的旧 composer 空不当作明确选择。明确选择由 useProfileDefault 的 scope/context choiceKey 单独读取。

## Studio 的 key 和三种数据结构

```ts
import {
  latestProfileId, resolveProfileId, flowProfileInitial, taskProfileInitial,
  profileScope, profileChoiceKey, readProfileChoice, writeProfileChoice,
  profileUnavailable, unavailableProfileOption,
} from './profile-defaults';
```

把 profiles 提前到现有 `const key=...` 声明后、fresh() 和 draft useState 前：

```ts
const profiles = t.list?.('profile') || [];
const profilesReady = t.state?.complete !== false;
const selectionScope = profileScope(t.state);
const profileKey = profileChoiceKey(selectionScope, key);
```

key 沿用 Studio 的 user/workspace/path/mode/draft-or-cover_session/latest/flow-or-task 作用域。App 已给 Studio 容器加 key={profileScope(state)}，账号/工作区改变会重建 React 状态；不用 token 作存储 key。

```ts
const explicit = readProfileChoice(profileKey);
// 本机结构：local.inputs.profile_id。空值只有 explicit==='' 才是明确空。
const localInitial = local?.inputs?.profile_id || explicit;
// API 原始远端结构：remote.profile_id 在顶层，不能读 remote.inputs。
const remoteInitial = remote?.profile_id || explicit;
// decodeDraft 后的内存结构：draft.inputs.profile_id。
const decodedInitial = draft.inputs.profile_id || explicit;
```

恢复逻辑继续按原来的范围/时间/版本选 local 或 remote；之后再补默认。不要因为 decodeDraft 给 profile_id 填了 ''，就把它永久锁定为通用表达。不要把历史版数/是否有 server_id 当明确空标记。

## flow/task origin 的明确选择继承

```ts
const flowChoice = readProfileChoice(
  profileChoiceKey(selectionScope, 'flow:' + requestedFlow)
);
const taskChoice = readProfileChoice(
  profileChoiceKey(selectionScope, 'task:' + requestedTask)
);
const originInitial = flowContext
  ? flowProfileInitial(originFlow, flowChoice)
  : taskContext ? (taskChoice ?? taskProfileInitial(originTask)) : undefined;
```

待 origin 读取成功后再应用继承。明确空可继承到新工具草稿；origin 的普通旧空不阻止最新默认。避免尚未载入的 origin 空对象被当作通用表达。

封面新草稿的 URL profile_id 来自 TopicDelivery：有字符串时保留该继承值（包括明确空），没有该参数时走默认。TopicDelivery 不再给“没有 IP 也没有明确选择”强塞空参数。

## 恢复结束后补一次默认（沿用现有 update/persist）

放在 update 声明后，使用本次 render 的 draft，避免恢复时 draftRef 尚未更新：

```ts
useEffect(() => {
  if (!spec || !synced || loading || scopeFailure.current || !profilesReady) return;
  // 若是 flow/task，额外等现有 origin 加载成功。
  const explicit = readProfileChoice(profileKey);
  const current = draft.inputs.profile_id || explicit || undefined;
  const inherited = /* 已读取的 originInitial，或明确的 URL profile_id */ undefined;
  // 空字符串不能用 || 丢掉：明确标记要单独判断。
  const initial = draft.inputs.profile_id || (explicit ?? inherited);
  if (!profiles.length && initial === undefined) return;
  const next = resolveProfileId(profiles, initial, true);
  if (next !== (draft.inputs.profile_id || '')) update({profile_id:next});
}, [synced, loading, profilesReady, profileKey, draft.id,
    draft.inputs.profile_id, latestProfileId(profiles) /* 和 originReady/originInitial */]);
```

注：上面 current 只是说明未标记空会归一为 undefined，实际代码可删除该变量；实际比较使用 initial，其中 explicit ?? inherited 保留明确空。如果 origin 已明确通用，但无标记 draft 默认空，则 next 为 ''，不会替换为最新 IP；之后手动选非空身份优先。

两个选择器 onChange 都沿用：

```ts
const chooseProfile = (value:string) => {
  writeProfileChoice(profileKey, value);
  update({profile_id:value});
};
```

生成前用 profileUnavailable 检查失效非空 ID，选择器用 unavailableProfileOption 提示。用户主动复用历史作品或旧生成参数时，非空身份保留；空参数仍按是否有明确选择标记归一，不把历史生成记录写回。

## PersonalIP

只改档案选择，不触碰主 Agent 的声音/形象说明：

```ts
const profile = profiles.find((p:any) => p.id === latestProfileId(profiles));
```

## 已接入的辅助 Agent 范围

- App / TaskWorkspace / 旧 Task：无标记空 composer 默认最新；明确空 choiceKey 与 identity_skipped 保留；非空历史身份不改。
- CreationFlow：首次、新建、API 返回 id/version1 空、旧 v5 空都遵循统一规则。点击新建请求显式 profile_id=latestProfileId(profiles)。
- TopicDelivery / TopicAddDrawer：继承 flow 的真实选择标记；手动/AI 选题的明确空在确认生成 topic id 后保存对应 scoped topic choiceKey，封面继续继承。
- 首页/知识问答/Today 复用 App.openTask，首条消息保留明确通用的 skip_profile。
- WechatArticleForm / ArticleImagePicker 本身无 IP 选择器，不改旧作品身份字段。

## 新建 flow 的真实 UI 断言

`node scripts/test-profile-defaults-ui.mjs`：启动独立 Vite 源码测试页与独立 headless Chrome context；所有 /api 请求由替身接管，不使用现有 worker、数据库、登录或 provider，也不依赖 dist/build。

实际点击“新建作品”，断言 POST new:true 的 profile_id 是最新 IP、API fixture 保存它、路由转到返回 flow id、DOM 身份 select 显示最新 IP，刷新后仍选最新。额外模拟 API 新 flow id/version1 空、旧 v5 无标记空、手动选通用后保存刷新、identity_skipped origin、异步档案列表。

`node scripts/test-profile-defaults.mjs`：helper 与真实 TSX handler 的隔离测试，覆盖任务缓存/默认、跨账号/工作区、origin 继承和删除提示。

上述 UI 验证是源码 React DOM 与 API 替身验证，不代表安装后升级或真实模型验收。
