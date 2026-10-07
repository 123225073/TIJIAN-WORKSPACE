import type {SVGProps} from 'react';

export type PlatformName = 'wechat' | 'channels' | 'douyin' | 'xiaohongshu' | 'moments';
export type PlatformIconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  platform: PlatformName | string;
  size?: number | string;
  /** Omit beside a visible platform name; supply for a standalone meaningful icon. */
  title?: string;
};

const aliases: Record<string, PlatformName> = {
  wechat: 'wechat', weixin: 'wechat', wechat_official: 'wechat', '公众号': 'wechat', '微信公众号': 'wechat',
  channels: 'channels', wechat_channels: 'channels', '视频号': 'channels',
  douyin: 'douyin', '抖音': 'douyin',
  xiaohongshu: 'xiaohongshu', rednote: 'xiaohongshu', xhs: 'xiaohongshu', '小红书': 'xiaohongshu',
  moments: 'moments', wechat_moments: 'moments', '朋友圈': 'moments',
};

/** Self-contained vector marks: no font, image URL or remote dependency. */
export function PlatformIcon({platform, size = 24, title, ...props}: PlatformIconProps) {
  const name = aliases[platform.trim().toLowerCase()];
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width={size} height={size}
    fill="none" focusable="false" role={title ? 'img' : undefined} aria-label={title}
    aria-hidden={title ? undefined : true} {...props}>
    {title && <title>{title}</title>}
    {name === 'wechat' && <>
      <rect width="32" height="32" rx="8" fill="#07A95C"/>
      <path d="M19.5 9.7c0-3.2-3.4-5.7-7.6-5.7S4.3 6.5 4.3 9.7c0 1.8 1 3.4 2.7 4.4l-.7 2.6 2.8-1.4c.9.3 1.8.4 2.8.4h.7c-.1-.4-.2-.9-.2-1.3 0-3 3.1-5.3 7.1-5.3v.6Z" fill="white" transform="translate(0 3)"/>
      <path d="M27.6 19c0-3-3.1-5.4-7-5.4s-7 2.4-7 5.4 3.1 5.4 7 5.4c.8 0 1.7-.1 2.4-.3l2.6 1.3-.6-2.4c1.6-1 2.6-2.4 2.6-4Z" fill="white"/>
      <g fill="#078747"><circle cx="9.4" cy="11.5" r="1"/><circle cx="14.7" cy="11.5" r="1"/><circle cx="18.2" cy="18" r=".9"/><circle cx="23" cy="18" r=".9"/></g>
    </>}
    {name === 'channels' && <>
      <rect width="32" height="32" rx="8" fill="#F0A52B"/>
      <path d="M9.2 6.8c-.9-.6-2 .1-2 1.2v16c0 1.1 1.1 1.8 2 1.2l11.6-8c.9-.6.9-1.8 0-2.4L9.2 6.8Z" fill="white"/>
      <path d="M19 7.8v4.3l5.6 3.9-5.6 3.9v4.3l9-6.3c1.3-.9 1.3-2.9 0-3.8l-9-6.3Z" fill="white"/>
    </>}
    {name === 'douyin' && <>
      <rect width="32" height="32" rx="8" fill="#14151B"/>
      <path d="M17 7h4c.3 3.2 2 4.8 5 5v4a10 10 0 0 1-5-1.5V22a6 6 0 1 1-6-6v4a2 2 0 1 0 2 2V7Z" fill="#25F4EE" transform="translate(-1 -1)"/>
      <path d="M17 7h4c.3 3.2 2 4.8 5 5v4a10 10 0 0 1-5-1.5V22a6 6 0 1 1-6-6v4a2 2 0 1 0 2 2V7Z" fill="#FE2C55" transform="translate(1 1)"/>
      <path d="M17 7h4c.3 3.2 2 4.8 5 5v4a10 10 0 0 1-5-1.5V22a6 6 0 1 1-6-6v4a2 2 0 1 0 2 2V7Z" fill="white"/>
    </>}
    {name === 'xiaohongshu' && <>
      <rect width="32" height="32" rx="8" fill="#E93449"/>
      <g stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7.5 11v10m-3-7.5-1 5m7-5 1 5M16 10l-3 5h4l-3 5h4m1-8h5m-2.5 0v9m-3 0h6M27 10v12m-1-7h4m-1-6v2"/>
      </g>
    </>}
    {name === 'moments' && <>
      <rect width="32" height="32" rx="8" fill="#FAFCFF"/>
      {['#54B968','#63B5DC','#4889CB','#7763B2','#D46CA0','#E77C4C','#E5B441','#A0BE50'].map((color, i) =>
        <path key={color} d="m16 5 6 3-6 7-4-4Z" fill={color} transform={`rotate(${i * 45} 16 16)`}/>) }
      <circle cx="16" cy="16" r="3" fill="#FAFCFF"/>
    </>}
    {!name && <g stroke="currentColor" strokeWidth="1.8"><circle cx="16" cy="16" r="11"/><ellipse cx="16" cy="16" rx="5" ry="11"/><path d="M5 16h22M7 10h18M7 22h18"/></g>}
  </svg>;
}

export default PlatformIcon;
