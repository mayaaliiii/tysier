(function(root){
  const AR='٠١٢٣٤٥٦٧٨٩', FA='۰۱۲۳۴۵۶۷۸۹';
  function norm(s){return String(s||'').replace(/[٠-٩]/g,d=>AR.indexOf(d)).replace(/[۰-۹]/g,d=>FA.indexOf(d)).replace(/٫/g,'.').replace(/٬/g,',').replace(/[\u200e\u200f\u202a-\u202e]/g,'');}
  function parse(text, rate){
    rate=Number(rate)||0; const out=[];
    for(const raw of norm(text).split(/\r?\n/)){
      const warn=/⚠/.test(raw);
      const line=raw.replace(/⚠/g,' ').replace(/[|_=~]+/g,' ').replace(/\s+/g,' ').trim();
      if(line.length<3||!/[A-Za-z\u0600-\u06FF]/.test(line)) continue;
      const nums=[...line.matchAll(/\d[\d,]*(?:\.\d+)?/g)]; if(!nums.length) continue;
      const last=nums[nums.length-1], price=parseFloat(last[0].replace(/,/g,'')); if(!(price>0)) continue;
      const isSyp=/ل\.?\s?س|ليرة|syp/i.test(line)&&!/\$|دولار|usd/i.test(line);
      let rest=(line.slice(0,last.index)+' '+line.slice(last.index+last[0].length)).replace(/\$|دولار|ل\.?\s?س|ليرة|usd|syp/ig,' ');
      const cm=rest.match(/(?<![\d.,])\d{4,}(?![\d.,])/); const code=cm?cm[0]:''; if(cm) rest=rest.replace(/(?<![\d.,])\d{4,}(?![\d.,])/g,' ');
      rest=rest.replace(/[^\u0600-\u06FFA-Za-z0-9\s\-./×x()%]/g,' ').replace(/^\s*\d+[\s.\-–)]+/,'');
      let dropped=false; const ar=(rest.match(/[\u0600-\u06FF]/g)||[]).length, la=(rest.match(/[A-Za-z]/g)||[]).length;
      if(ar>la) rest=rest.split(/\s+/).filter(t=>{const bad=/^[A-Za-z]{1,3}$/.test(t)||(/[\u0600-\u06FF]/.test(t)&&/[A-Za-z]/.test(t));if(bad)dropped=true;return !bad;}).join(' ');
      const name=rest.replace(/[\s\-–.،,:]+$/,'').replace(/\s+/g,' ').trim(); if(name.length<2) continue;
      const usd=isSyp?(rate?price/rate:0):price, syp=isSyp?price:(rate?price*rate:0);
      const check=warn||dropped||ar===0||!(usd>0)||name.length<3||(!isSyp&&price>5000)||(nums.length===1&&!!code&&!isSyp);
      out.push({name,code,priceUsd:Math.round(usd*100)/100,priceSyp:Math.round(syp),currency:isSyp?'SYP':'USD',check});
    }
    return out;
  }
  const api={parse,norm}; if(typeof module!=='undefined') module.exports=api; else root.TaysirParser=api;
})(typeof window!=='undefined'?window:globalThis);
