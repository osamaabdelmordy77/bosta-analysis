import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';

const out = path.resolve('docs/phase-00/fixtures');
const manifest = JSON.parse(fs.readFileSync(path.resolve('docs/phase-00/bosta_211_column_manifest.json'), 'utf8'));
const headers = manifest.sort((a,b)=>a.source_number-b.source_number).map(x=>x.source_label);
const attemptFields = ['Type','By','HuB Name','Date'];
function makeRow(values, attempts = {}) {
  const row = Array(headers.length).fill(null);
  for (const [label,value] of Object.entries(values)) {
    const col = headers.indexOf(label);
    if (col >= 0) row[col] = value;
  }
  for (const [group, data] of Object.entries(attempts)) {
    const prefix = Number(group) === 0 ? 'Attempt' : `Attempt ${group}`;
    const exPrefix = Number(group) === 0 ? 'Exception' : `Exception ${group}`;
    const labels = {
      [`${prefix} Type`]: data.type,
      [`${prefix} By`]: data.by,
      [`${prefix} HuB Name`]: data.hub,
      [`${prefix} Date`]: data.date,
      [`${exPrefix} Fake Attempt`]: data.fake,
      [`${exPrefix} Reason`]: data.reason,
      [`${exPrefix} time`]: data.exceptionAt,
      [`${exPrefix} lat/long`]: data.latlong,
    };
    for (const [label,value] of Object.entries(labels)) {
      const col = headers.indexOf(label);
      if (col >= 0) row[col] = value ?? null;
    }
  }
  return row;
}
const allAttempts = Object.fromEntries(Array.from({length:9}, (_,i)=>[String(i),{
  type: `Synthetic attempt ${i}`, by: `Synthetic agent ${i}`, hub: `Hub ${i%2 ? 'East':'Central'}`,
  date: `2026-07-${String(i+1).padStart(2,'0')} 09:00:00`, fake: i === 8 ? 'Yes' : 'No',
  reason: i === 8 ? 'Synthetic exception' : null, exceptionAt: i === 8 ? '2026-07-09 09:05:00' : null,
  latlong: i === 8 ? '30.0444,31.2357' : null
}]));
function write(name, sheets) {
  const wb = XLSX.utils.book_new();
  for (const [sheetName, rows] of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), sheetName);
  }
  XLSX.writeFile(wb, path.join(out,name), { compression: true });
}
write('synthetic_bosta_2026-07-01.xlsx', [
  ['Report', [
    makeRow({'Tracking Number':'SYN-0001','Business':'Synthetic Alpha','Items':2,'Assigned Hub':'Hub Central','Current Hub':'Hub East','Pickup City':'Cairo','DropOff City':'Giza','Created At':'2026-07-01 10:00:00','Cod Amount':100.25}, allAttempts),
    makeRow({'Tracking Number':'SYN-0002','Business':'Synthetic Alpha','Items':null,'Assigned Hub':'Hub East','Pickup City':'Alexandria','DropOff City':'Cairo','Created At':'31/02/2026','Cod Amount':null}),
    makeRow({'Tracking Number':'SYN-0001','Business':'Synthetic Duplicate','Items':99,'Assigned Hub':'Hub Duplicate','Created At':'2026-07-01','Cod Amount':999.99}),
  ]],
  ['Continuation', [
    makeRow({'Tracking Number':'SYN-0001','Business':'Synthetic Duplicate Sheet','Items':7,'Assigned Hub':'Hub Duplicate','Pickup City':'Cairo','DropOff City':'Giza','Created At':'2026-07-01','Cod Amount':7.5}),
    makeRow({'Tracking Number':'SYN-0003','Business':'Synthetic Beta','Items':3,'Assigned Hub':'Hub Central','Pickup City':'Cairo','DropOff City':'Giza','Created At':'2026-07-01','Cod Amount':2500.5}),
    makeRow({'Tracking Number':null,'Business':'Missing Tracking Row','Items':5,'Assigned Hub':'Hub East','Created At':'2026-07-01','Cod Amount':50}),
  ]]
]);
write('synthetic_bosta_2026-07-02.xlsx', [
  ['Report', [
    makeRow({'Tracking Number':'SYN-0001','Business':'Synthetic Alpha','Items':1,'Assigned Hub':'Hub Central','Pickup City':'Cairo','DropOff City':'Giza','Created At':'2026-07-02','Cod Amount':100.25}),
    makeRow({'Tracking Number':'SYN-0004','Business':'Synthetic Beta','Items':0,'Assigned Hub':null,'Pickup City':null,'DropOff City':'Giza','Created At':'not-a-date','Cod Amount':-12.75}),
  ]]
]);
