// طبقة بديلة لـ Electron: تعيد تعريف window.taysirAPI داخل المتصفح (للموبايل)
(()=>{
  if(window.taysirAPI) return;
  const KEY='taysir_gemini_key';
  const getKey=a=>String((a&&a.apiKey)||localStorage.getItem(KEY)||'').trim();
  const err=(e,d)=>({ok:false,error:`${e&&e.code?`Gemini ${e.code}: `:''}${(e&&e.message)||d}`});
  async function postJson(url,apiKey,payload){
    const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),120000);let res,text;
    try{res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},body:JSON.stringify(payload),signal:ctl.signal});text=await res.text();}
    catch(e){throw new Error('تعذر الوصول إلى خوادم Google. تأكد من الإنترنت (وVPN إن كنت تستخدمه).');}
    finally{clearTimeout(t);}
    let j=null;try{j=JSON.parse(text);}catch(_){}
    if(res.ok)return j;
    let d=j?.error?.message||`Gemini HTTP ${res.status}`;
    if(/location is not supported/i.test(d))d+=' — Gemini غير مدعوم من موقعك الحالي، فعّل VPN.';
    const e=new Error(d);e.code=res.status;throw e;
  }
  async function callGemini(apiKey,parts,opts={}){
    const json=opts.json!==false;let last;
    for(const m of ['gemini-3.5-flash','gemini-2.5-flash']){
      try{
        const r=await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`,apiKey,{contents:[{role:'user',parts}],generationConfig:Object.assign({temperature:0},json?{responseMimeType:'application/json'}:{})});
        const t=(r?.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('').trim();
        if(t)return t;last=new Error('Gemini أرجع ردّاً فارغاً.');
      }catch(e){last=e;if(e.code!==400&&e.code!==404)throw e;}
    }
    throw last||new Error('تعذر الاتصال بـ Gemini.');
  }
  const loose=t=>{try{return JSON.parse(t);}catch(_){const x=String(t).match(/[\[{][\s\S]*[\]}]/);if(!x)return null;try{return JSON.parse(x[0]);}catch(e){return null;}}};

  window.taysirAPI={
    async saveGeminiKey({apiKey}={}){
      apiKey=String(apiKey||'').trim();
      if(!apiKey)return{ok:false,error:'أدخل مفتاح Gemini.'};
      if(!/^AQ\.|^AIza|^[A-Za-z0-9_-]{20,}$/.test(apiKey))return{ok:false,error:'صيغة مفتاح Gemini تبدو غير صحيحة.'};
      try{localStorage.setItem(KEY,apiKey);return{ok:true};}catch(e){return{ok:false,error:'تعذر حفظ المفتاح على هذا المتصفح.'};}
    },
    async geminiStatus(){return{ok:true,configured:!!getKey()};},
    async generateGeminiText(a={}){
      const k=getKey(a);if(!k)return{ok:false,error:'أضف مفتاح Gemini أولاً.'};
      const p=String(a.prompt||'').trim();if(!p)return{ok:false,error:'لا يوجد طلب للمساعد.'};
      try{const d=loose(await callGemini(k,[{text:p}]));return d?{ok:true,data:d}:{ok:false,error:'تعذر قراءة رد Gemini.'};}catch(e){return err(e,'تعذر الاتصال بـ Gemini.');}
    },
    async testGemini(a={}){
      const k=getKey(a);if(!k)return{ok:false,error:'أدخل مفتاح Gemini.'};
      try{return{ok:true,text:await callGemini(k,[{text:'Reply with exactly: TAYSIR_OK'}],{json:false})};}catch(e){return err(e,'تعذر اختبار Gemini.');}
    },
    async geminiReadPage(a={}){
      const k=getKey(a);if(!k)return{ok:false,error:'أضف مفتاح Gemini أولاً.'};
      if(!a.image)return{ok:false,error:'لا توجد صورة للصفحة.'};
      const prompt='You are a meticulous OCR system for an Arabic price-list table page. Table columns from right to left: product image, product code (digits), product name (Arabic), price in USD. '+
        'Return ONLY JSON: {"rows":[{"code":"10210","name":"...","price":0.35,"row_box":[ymin,xmin,ymax,xmax],"image_box":[ymin,xmin,ymax,xmax]}]} where boxes are normalized 0-1000 relative to the whole page image (row_box = the entire table row, image_box = the product photo cell). '+
        'Rules: copy every product name EXACTLY as printed (same Arabic spelling, slashes, numbers and units); never translate, never correct, never invent or complete words; skip the header row, titles, logos and empty rows; keep the price as printed (0.00 means 0). '+
        (a.second?'Process the rows from the bottom of the page to the top.':'Process the rows from the top of the page to the bottom.');
      try{
        const d=loose(await callGemini(k,[{text:prompt},{inline_data:{mime_type:'image/jpeg',data:String(a.image)}}]));
        const rows=Array.isArray(d)?d:d?.rows;
        return Array.isArray(rows)?{ok:true,data:{rows}}:{ok:false,error:'تعذر قراءة رد Gemini للصفحة.'};
      }catch(e){return err(e,'فشلت قراءة الصفحة.');}
    },
    async generateGeminiImage(a={}){
      const k=getKey(a);if(!k)return{ok:false,error:'أضف مفتاح Gemini أولاً.'};
      const imgs=Array.isArray(a.images)?a.images.map(String).filter(Boolean):[String(a.image||'')].filter(Boolean);
      if(!imgs.length)return{ok:false,error:'لا توجد صورة مصدر لهذا المنتج.'};
      const parts=[{text:String(a.prompt||'')}];
      for(const im of imgs){const m=im.match(/^data:([^;]+);base64,(.+)$/s);if(!m)return{ok:false,error:'صيغة صورة المصدر غير مدعومة.'};parts.push({inline_data:{mime_type:m[1],data:m[2]}});}
      const aspect=String(a.aspect||'4:5');let last;
      for(const model of ['gemini-2.5-flash-image','gemini-3.1-flash-image-preview','gemini-3-pro-image-preview']){
        for(const withAspect of [true,false]){
          try{
            const r=await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,k,{contents:[{role:'user',parts}],generationConfig:Object.assign({responseModalities:['TEXT','IMAGE']},withAspect?{imageConfig:{aspectRatio:aspect}}:{})});
            for(const p of (r?.candidates?.[0]?.content?.parts||[])){const d=p.inlineData||p.inline_data;if(d?.data)return{ok:true,image:`data:${d.mimeType||d.mime_type||'image/png'};base64,${d.data}`};}
            last=new Error('Gemini لم يرجع صورة (ربما رفض المحتوى).');break;
          }catch(e){last=e;if(e.code===400&&withAspect)continue;if(e.code===400||e.code===404)break;return err(e,'تعذر توليد الصورة.');}
        }
      }
      return err(last,'تعذر توليد الصورة.');
    },
    async getExchangeRate(){
      const urls=['https://www.sp-today.com/currencies','https://allira-sy.com/currencies'];
      for(const u of urls){
        for(const f of [x=>x,x=>'https://api.allorigins.win/raw?url='+encodeURIComponent(x)]){
          try{
            const c=new AbortController(),t=setTimeout(()=>c.abort(),10000);
            const r=await fetch(f(u),{signal:c.signal});clearTimeout(t);if(!r.ok)continue;
            const text=(await r.text()).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ');
            const m=text.match(/USD\s*(?:دولار أمريكي)?\s*(?:137\.50|[0-9]{1,4}(?:\.[0-9]+)?)\s*(?:[0-9,]+\s*قديمة)?\s*(?:138\.25|[0-9]{1,4}(?:\.[0-9]+)?)/i);
            if(!m)continue;
            const v=(m[0].match(/[0-9]+(?:\.[0-9]+)?/g)||[]).map(Number).filter(n=>n>50&&n<1000);
            if(v.length>=2)return{ok:true,buy:v[0],sell:v[1],value:v[1],source:'sp-today.com',fetchedAt:Date.now()};
          }catch(_){}
        }
      }
      return{ok:false,error:'تعذر جلب سعر الصرف حالياً. استخدم السعر اليدوي من الإعدادات.'};
    }
  };

  // الإطار (iframe) غالباً محظور في المتصفح → بطاقة سعر بسيطة بدلاً منه
  document.addEventListener('DOMContentLoaded',()=>{
    const f=document.getElementById('lyra-iframe');if(!f)return;
    const d=document.createElement('div');d.className='rate-lite';
    d.innerHTML='<span>الدولار اليوم</span><strong id="rate-lite-val">—</strong><small>ل.س / $</small>';
    f.replaceWith(d);
    const sync=()=>{const s=document.getElementById('exchange-top');const v=document.getElementById('rate-lite-val');if(s&&v)v.textContent=s.textContent;};
    sync();setInterval(sync,1500);
  });
})();
