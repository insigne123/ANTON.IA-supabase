/** Source dates without a zone use Chile's real calendar/DST, not a permanent -03:00 offset. */
export function opportunitySourceDate(value:unknown):string|null {
 if(typeof value!=='string'||!value.trim())return null;
 const raw=value.trim();
 if(/[zZ]|[+-]\d\d:?\d\d$/.test(raw)){const t=Date.parse(raw);return Number.isFinite(t)?new Date(t).toISOString():null;}
 const match=raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
 if(!match)return null;
 const [year,month,day,hour,minute,second]=match.slice(1,7).map(v=>Number(v||0));
 const intended=Date.UTC(year,month-1,day,hour,minute,second);let instant=intended+3*3600000;
 const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santiago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 for(let i=0;i<3;i++){
  const parts=formatter.formatToParts(new Date(instant));const p=(key:string)=>Number(parts.find(v=>v.type===key)?.value||0);
  const observed=Date.UTC(p('year'),p('month')-1,p('day'),p('hour'),p('minute'),p('second'));
  if(observed===intended)return new Date(instant+Number((match[7]||'').padEnd(3,'0'))).toISOString();
  instant+=intended-observed;
 }
 return null; // Nonexistent spring-transition local times are not invented.
}
