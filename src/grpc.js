// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Hunk and MultiHunk both use protobuf field 1 (bytes). MultiHunk repeats it.
export function decodeHunk(bytes) {
  let offset=0;
  const chunks=[];
  function varint(){let value=0, multiplier=1;for(let i=0;i<8;i++){if(offset>=bytes.length)throw Error('Truncated protobuf varint');const b=bytes[offset++];value+=(b&127)*multiplier;if(!Number.isSafeInteger(value))throw Error('Protobuf varint overflow');if(!(b&128))return value;multiplier*=128;}throw Error('Protobuf varint too long');}
  function take(length){if(!Number.isSafeInteger(length)||length<0||offset+length>bytes.length)throw Error('Truncated protobuf field');const part=bytes.subarray(offset,offset+length);offset+=length;return part;}
  while(offset<bytes.length){const tag=varint(),field=Math.floor(tag/8),wire=tag%8;if(!field)throw Error('Invalid protobuf field');if(wire===2){const chunk=take(varint());if(field===1)chunks.push(chunk);}else if(wire===0)varint();else if(wire===1)take(8);else if(wire===5)take(4);else throw Error('Unsupported protobuf wire type');}
  // Validate the entire message before returning a shared view for a single Hunk.
  if(chunks.length===1)return chunks[0];
  const total=chunks.reduce((sum,chunk)=>sum+chunk.length,0),result=new Uint8Array(total);
  let end=0;for(const chunk of chunks){result.set(chunk,end);end+=chunk.length;}return result;
}
