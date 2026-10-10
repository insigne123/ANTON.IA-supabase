import {dayInZone,shiftDay} from '@/lib/admin/chile-time';
export const HOME_ZONE='America/Santiago';
const dayStarts=new Map<string,number>();
/** First instant of the Chile calendar day, including the missing midnight at DST start. */
export function homeDayStart(day:string){
  const midnight=Date.parse(day+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(midnight)||new Date(midnight).toISOString().slice(0,10)!==day)throw Error('Invalid day');
  const cached=dayStarts.get(day);if(cached!==undefined)return new Date(cached);
  let low=midnight-36*3600000,high=midnight+36*3600000;
  while(low<high){const middle=Math.floor((low+high)/2);if(dayInZone(new Date(middle),HOME_ZONE)<day)low=middle+1;else high=middle;}
  if(dayStarts.size>32)dayStarts.delete(dayStarts.keys().next().value!);dayStarts.set(day,low);return new Date(low);
}
export function homeScope(userId:string,organizationId:string,now=new Date()){
  const dayKey=dayInZone(now,HOME_ZONE);
  return {userId,organizationId,dayKey,timeZone:HOME_ZONE,from:homeDayStart(dayKey).toISOString(),to:homeDayStart(shiftDay(dayKey,1)).toISOString(),generatedAt:now.toISOString()};
}
export type HomeScope=ReturnType<typeof homeScope>;
