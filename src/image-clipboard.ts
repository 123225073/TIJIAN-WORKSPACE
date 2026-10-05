const imageTypes:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'};

function asImageFile(blob:Blob,index:number):File|null{
 const type=blob.type.toLowerCase();
 const extension=imageTypes[type];
 return extension?new File([blob],`screenshot-${Date.now()}-${index}.${extension}`,{type}):null;
}

export function pastedImages(data:DataTransfer):File[]{
 const blobs=Array.from(data.items).filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter((blob):blob is File=>!!blob);
 if(!blobs.length)blobs.push(...Array.from(data.files).filter(file=>file.type.startsWith('image/')));
 return blobs.map(asImageFile).filter((file):file is File=>!!file);
}

export async function readClipboardImages():Promise<File[]>{
 const desktop=(window as Window & {tijianDesktop?:{readClipboardImage?:()=>Promise<string|null>}}).tijianDesktop;
 if(desktop?.readClipboardImage){
  const base64=await desktop.readClipboardImage();
  if(!base64)throw Error('剪贴板里没有图片，请先截图并复制');
  const bytes=Uint8Array.from(atob(base64),char=>char.charCodeAt(0));
  return [new File([bytes],`screenshot-${Date.now()}.png`,{type:'image/png'})];
 }
 if(!navigator.clipboard?.read)throw Error('无法直接读取剪贴板，请先复制截图，再点此按钮并按 Ctrl+V');
 const items=await navigator.clipboard.read();
 const files:File[]=[];
 for(const item of items){
  const type=item.types.find(value=>value in imageTypes);
  if(!type)continue;
  const file=asImageFile(await item.getType(type),files.length+1);
  if(file)files.push(file);
 }
 if(!files.length)throw Error('剪贴板里没有 PNG、JPG 或 WebP 图片，请先截图并复制');
 return files;
}
