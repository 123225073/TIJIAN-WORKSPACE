// Form defaults use the user's local calendar, never the UTC date.
export function localDay(now = new Date()): string {
 return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}
export function monthStart(now = new Date()): string {return localDay(now).slice(0,8)+'01'}
export function localMinute(now = new Date()): string {
 return `${localDay(now)}T${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
}
export function dateDefault(type?: string): string {
 return type==='date'?localDay():type==='datetime-local'?localMinute():'';
}
