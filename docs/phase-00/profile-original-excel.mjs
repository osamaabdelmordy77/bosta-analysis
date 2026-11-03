import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import XLSX from 'xlsx';

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/phase-00/bosta_211_column_manifest.json'), 'utf8'));
const sourceFile = fs.readdirSync(root).filter(name => /\.(xlsx|xls|xlsm)$/i.test(name) && !name.startsWith('~$')).map(name => path.join(root,name));
if (sourceFile.length !== 1) throw new Error(`Expected one original workbook in root, found ${sourceFile.length}`);
const normalize = value => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'');
const expectedByNorm = new Map(manifest.map(item => [normalize(item.source_label), item]));
const isNumericSemantic = item => /^(unsignedInteger|integer|decimal\()/.test(item?.provisional_type ?? '');
const wb = XLSX.readFile(sourceFile[0], { cellDates: true, cellNF: true, cellText: false });
const sheetProfiles = [];
const trackingAll = new Map();
const attemptGroupStats = Object.fromEntries(Array.from({length:9},(_,i)=>[String(i),{nonEmptyRows:0,nonEmptyCells:0,totalCells:0}]));
const globalFields = new Map();
let allRows = 0, blankRows = 0;
for (let sheetIndex=0; sheetIndex<wb.SheetNames.length; sheetIndex++) {
  const sheetName=wb.SheetNames[sheetIndex];
  const ws=wb.Sheets[sheetName];
  const aoa=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:null,blankrows:false});
  let headerIndex=0,best=-1;
  for(let i=0;i<Math.min(20,aoa.length);i++){
    const score=(aoa[i]||[]).filter(v=>typeof v==='string'&&v.trim()).length;
    if(score>best){best=score;headerIndex=i;}
  }
  const headers=(aoa[headerIndex]||[]).map(v=>String(v??'').trim());
  const rows=aoa.slice(headerIndex+1);
  const normHeaders=headers.map(normalize);
  const trackingIndex=normHeaders.findIndex(h=>['trackingnumber','trackingno','trackingnum','trackingid','tracking'].includes(h));
  const columnProfiles=[];
  const dupHeaderNorms=normHeaders.filter((h,i)=>h&&normHeaders.indexOf(h)!==i);
  let nonBlankRows=0, missingTracking=0;
  const seenSheet=new Set();
  let duplicatesWithinSheet=0;
  for(let c=0;c<headers.length;c++){
    const label=headers[c];
    const expected=expectedByNorm.get(normalize(label));
    const p={sourceLabel:label||`<blank header ${c+1}>`,columnIndex:c+1,manifestMatch:!!expected,manifestSourceNumber:expected?.source_number??null,table:expected?.table??null,physicalColumn:expected?.physical_column??null,provisionalType:expected?.provisional_type??null,group:expected?.group??null,nonBlank:0,blank:0,types:{string:0,number:0,boolean:0,date:0,other:0},maxStringLength:0,numericString:0,numericMin:null,numericMax:null,maxDecimalScale:0,negativeNumeric:0,dateFormattedNumeric:0,dateLikeString:0,dateStringFormats:{isoDateTime:0,isoDate:0,dayFirstSlash:0,dayFirstDash:0,other:0},booleanLikeString:0,distinctExact:0};
    const distinct=new Set();
    for(let r=headerIndex+1;r<aoa.length;r++){
      const row=aoa[r]||[]; const value=row[c];
      if(value==null||value===''){p.blank++;continue;}
      p.nonBlank++;
      if(value instanceof Date){p.types.date++;}
      else if(typeof value==='string'){
        p.types.string++;p.maxStringLength=Math.max(p.maxStringLength,value.length);
        const trimmed=value.trim();
        if(trimmed!==''&&Number.isFinite(Number(trimmed.replace(/,/g,'')))){
          p.numericString++;
          if(isNumericSemantic(expected)){
            const n=Number(trimmed.replace(/,/g,''));
            p.numericMin=p.numericMin===null?n:Math.min(p.numericMin,n);p.numericMax=p.numericMax===null?n:Math.max(p.numericMax,n);
            const dec=(trimmed.replace(/,/g,'').split('.')[1]||'').length;p.maxDecimalScale=Math.max(p.maxDecimalScale,dec);if(n<0)p.negativeNumeric++;
          }
        }
        if(/\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(trimmed)){
          p.dateLikeString++;
          if(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(trimmed))p.dateStringFormats.isoDateTime++;
          else if(/^\d{4}-\d{2}-\d{2}$/.test(trimmed))p.dateStringFormats.isoDate++;
          else if(/^\d{1,2}\/\d{1,2}\/\d{4}/.test(trimmed))p.dateStringFormats.dayFirstSlash++;
          else if(/^\d{1,2}-\d{1,2}-\d{4}/.test(trimmed))p.dateStringFormats.dayFirstDash++;
          else p.dateStringFormats.other++;
        }
        if(/^(true|false|yes|no|0|1)$/i.test(trimmed))p.booleanLikeString++;
      } else if(typeof value==='number'){
        p.types.number++;
        if(isNumericSemantic(expected)){
          p.numericMin=p.numericMin===null?value:Math.min(p.numericMin,value);p.numericMax=p.numericMax===null?value:Math.max(p.numericMax,value);
          const scale=String(value).split('.')[1]?.length||0;p.maxDecimalScale=Math.max(p.maxDecimalScale,scale);if(value<0)p.negativeNumeric++;
        }
        const cell=ws[XLSX.utils.encode_cell({r,c})];if(cell?.z&&XLSX.SSF.is_date(cell.z))p.dateFormattedNumeric++;
      } else if(typeof value==='boolean')p.types.boolean++;
      else p.types.other++;
      distinct.add(typeof value==='string'?value:`${typeof value}:${String(value)}`);
    }
    p.distinctExact=distinct.size;
    columnProfiles.push(p);
    if(expected){
      const key=`${expected.source_number}:${expected.source_label}`;
      const prior=globalFields.get(key)||{sourceNumber:expected.source_number,sourceLabel:expected.source_label,table:expected.table,physicalColumn:expected.physical_column,sheets:[],nonBlank:0,blank:0,types:{string:0,number:0,boolean:0,date:0,other:0},maxStringLength:0,numericString:0,numericMin:null,numericMax:null,maxDecimalScale:0,negativeNumeric:0,dateFormattedNumeric:0,dateLikeString:0,distinctBySheet:[]};
      prior.sheets.push({name:sheetName,nonBlank:p.nonBlank,blank:p.blank});prior.nonBlank+=p.nonBlank;prior.blank+=p.blank;
      for(const t of Object.keys(prior.types))prior.types[t]+=p.types[t];
      prior.maxStringLength=Math.max(prior.maxStringLength,p.maxStringLength);prior.numericString+=p.numericString;
      if(p.numericMin!==null)prior.numericMin=prior.numericMin===null?p.numericMin:Math.min(prior.numericMin,p.numericMin);
      if(p.numericMax!==null)prior.numericMax=prior.numericMax===null?p.numericMax:Math.max(prior.numericMax,p.numericMax);
      prior.maxDecimalScale=Math.max(prior.maxDecimalScale,p.maxDecimalScale);prior.negativeNumeric+=p.negativeNumeric;prior.dateFormattedNumeric+=p.dateFormattedNumeric;prior.dateLikeString+=p.dateLikeString;prior.distinctBySheet.push(p.distinctExact);globalFields.set(key,prior);
    }
  }
  for(let r=headerIndex+1;r<aoa.length;r++){
    const row=aoa[r]||[];if(row.every(v=>v==null||v==='')){blankRows++;continue;}allRows++;nonBlankRows++;
    if(trackingIndex>=0){const v=row[trackingIndex];if(v==null||v===''){missingTracking++;continue;}const k=String(v).trim();trackingAll.set(k,(trackingAll.get(k)||0)+1);if(seenSheet.has(k))duplicatesWithinSheet++;seenSheet.add(k);}
  }
  for(const entry of manifest.filter(x=>x.table==='delivery_attempts')){
    const c=normHeaders.indexOf(normalize(entry.source_label));if(c<0)continue;
    const group=attemptGroupStats[String(entry.group)];
    for(let r=headerIndex+1;r<aoa.length;r++){const v=(aoa[r]||[])[c];if(v!=null&&v!==''){group.nonEmptyCells++;group.nonEmptyRows++;}group.totalCells++;}
  }
  sheetProfiles.push({sheetIndex:sheetIndex+1,sheetName,range:ws['!ref']??null,headerRow:headerIndex+1,headerCount:headers.length,nonBlankHeaderCount:headers.filter(Boolean).length,dataRows:rows.length,nonBlankRows,trackingHeader:trackingIndex>=0?headers[trackingIndex]:null,missingTrackingRows:missingTracking,duplicateTrackingRowsWithinSheet:duplicatesWithinSheet,duplicateNormalizedHeaders:[...new Set(dupHeaderNorms)],columns:columnProfiles});
}
const exactHeaderLabels=new Set(sheetProfiles.flatMap(s=>s.columns.filter(c=>c.manifestMatch).map(c=>c.sourceLabel)));
const normalizedHeaderLabels=new Set(sheetProfiles.flatMap(s=>s.columns.filter(c=>c.manifestMatch).map(c=>normalize(c.sourceLabel))));
const missingExact=manifest.filter(x=>!exactHeaderLabels.has(x.source_label));
const duplicateLabels=sheetProfiles.flatMap(s=>s.duplicateNormalizedHeaders.map(name=>({sheet:s.sheetName,normalizedHeader:name})));
const dupTrack=Array.from(trackingAll.values()).filter(n=>n>1);
for (const field of globalFields.values()) { delete field.numericMin; delete field.numericMax; }
for (const sheet of sheetProfiles) for (const column of sheet.columns) { delete column.numericMin; delete column.numericMax; }
const formulaCellCount=wb.SheetNames.reduce((sum,name)=>sum+Object.keys(wb.Sheets[name]).filter(key=>!key.startsWith('!')&&wb.Sheets[name][key]?.f).length,0);
const reportDateCandidate=path.basename(sourceFile[0]).match(/(?:^|[^0-9])(20\d{2})[-_.](\d{2})[-_.](\d{2})(?:[^0-9]|$)/);
const profile={source:{fileName:path.basename(sourceFile[0]),bytes:fs.statSync(sourceFile[0]).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(sourceFile[0])).digest('hex'),workbookType:path.extname(sourceFile[0]).slice(1).toLowerCase(),sheetCount:wb.SheetNames.length,reportDateFilenameCandidate:reportDateCandidate?`${reportDateCandidate[1]}-${reportDateCandidate[2]}-${reportDateCandidate[3]}`:null},workbookTotals:{nonBlankDataRows:allRows,blankDataRows:blankRows,formulaCellCount,uniqueTrackingValues:trackingAll.size,repeatedTrackingValues:dupTrack.length,repeatedTrackingOccurrences:dupTrack.reduce((a,n)=>a+n-1,0),uniqueManifestColumnsObserved:normalizedHeaderLabels.size,manifestColumns:manifest.length,missingExactManifestHeaders:missingExact.map(x=>({sourceNumber:x.source_number,sourceLabel:x.source_label})),duplicateHeaders:duplicateLabels,attemptGroups:attemptGroupStats},sheets:sheetProfiles,manifestProfiles:Array.from(globalFields.values()).sort((a,b)=>a.sourceNumber-b.sourceNumber),notes:['No raw cell values or tracking numbers are included in this profile.','Date-like string counts are lexical, not proof of a semantic timezone or valid business date.','Numeric Excel cells cannot prove preservation of leading zeroes in source identifiers.']};
fs.writeFileSync(path.join(root,'docs/phase-00/original_excel_profile.json'),JSON.stringify(profile,null,2)+'\n');
console.log(JSON.stringify({source:profile.source,totals:profile.workbookTotals,sheets:sheetProfiles.map(({columns,...rest})=>rest),manifestGroupCounts:manifest.reduce((o,x)=>(o[x.table]=(o[x.table]||0)+1,o),{})},null,2));
