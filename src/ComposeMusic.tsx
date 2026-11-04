import {useState, type FormEvent} from 'react';

export type MusicRange = {start: number; trim: number; length: number};
export type MusicClip = {asset_id: string; volume: number; enabled?: boolean} & Partial<MusicRange>;

export const preciseSeconds = (value: number) => Math.round(value * 1000) / 1000;
export const hasMusicRange = (music: MusicClip) => music.start != null || music.trim != null || music.length != null;

export function musicRange(music: MusicClip, sourceDuration: number, total: number): MusicRange {
 const start = music.start ?? 0;
 const trim = music.trim ?? 0;
 return {start, trim, length: music.length ?? Math.max(0, Math.min(total - start, (sourceDuration || total) - trim))};
}

export function MusicRangeEditor({range, sourceDuration, total, speed, onApply}: {
 range: MusicRange; sourceDuration: number; total: number; speed: number; onApply: (range: MusicRange) => void;
}) {
 const [error, setError] = useState('');
 const apply = (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const trim = Number(data.get('in'));
  const end = Number(data.get('out'));
  const start = preciseSeconds(Number(data.get('start')) * speed);
  const length = preciseSeconds(end - trim);
  if (length < .001 || (sourceDuration > 0 && end > sourceDuration + .0005)) {
   setError('素材终点须晚于起点，并在原音频时长以内。');
   return;
  }
  if (total <= start || start + length > total + .001) {
   setError('所选片段超出主画面时长。请缩短音乐片段或提前进入成片的时间。');
   return;
  }
  setError('');
  onApply({start, trim: preciseSeconds(trim), length});
 };
 return <form className="lc-music-trim" onSubmit={apply}>
  <div className="lc-fields">
   <label className="lc-field">素材起点（秒）<input name="in" type="number" min="0" step="0.001" required defaultValue={preciseSeconds(range.trim)}/></label>
   <label className="lc-field">素材终点（秒）<input name="out" type="number" min="0.001" step="0.001" required defaultValue={preciseSeconds(range.trim + range.length)}/></label>
   <label className="lc-field">进入成片的时间（秒）<input name="start" type="number" min="0" step="0.001" required defaultValue={preciseSeconds(range.start / speed)}/></label>
   <div className="lc-music-duration"><small>裁剪后原音频</small><strong>{preciseSeconds(range.length)} 秒</strong></div>
  </div>
  <div className="lc-row"><button type="submit" className="lc-button">应用裁剪</button><small className="lc-muted">{sourceDuration > 0 ? `原音频 ${preciseSeconds(sourceDuration)} 秒` : '按原音频时间填写'}</small></div>
  {error && <p className="lc-warning" role="alert">{error}</p>}
 </form>;
}
