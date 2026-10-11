(() => {
  'use strict';

  const DB_NAME = 'taysir-center-db';
  const DB_VERSION = 1;
  const STORE = 'state';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const defaultState = {
    products: [], invoices: [], customers: [], slides: [], companies: [], categories: ['الكل'],
    exchangeRate: 0, exchangeBuy: 0, exchangeSell: 0, exchangeFetchedAt: '', exchangeSource: '', direction: 'flat', undoDelete: true,
    contacts: [], groups: [], managerName: '', geminiConfigured: false, reviewQueue: [], sourcePages: {}, suggestionHistory: [],
    business: { address: '', shamCashBarcode: '', channelBarcode: '', ordersOpen: '09:00', ordersClose: '18:00' }
  };
  let state = structuredClone(defaultState);
  let db;
  let activeCategory = 'الكل';
  let lastDeletedInvoice = null;
  let undoTimer = null;
  let selIds=new Set(), visibleIds=[];
  let cameraStream=null, cameraImage='';

  function uid(prefix='id') { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`; }
  function esc(value='') { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function money(n) { return new Intl.NumberFormat('en-US',{maximumFractionDigits:2,useGrouping:true}).format(Number(n)||0); }
  function nowText() { return new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'}).format(new Date()); }

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function dbGet(key) {
    return new Promise((resolve,reject)=>{ const tx=db.transaction(STORE,'readonly'); const r=tx.objectStore(STORE).get(key); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); });
  }
  function dbSet(key,value) {
    return new Promise((resolve,reject)=>{ const tx=db.transaction(STORE,'readwrite'); const r=tx.objectStore(STORE).put(value,key); r.onsuccess=()=>resolve(); r.onerror=()=>reject(r.error); });
  }
  async function persist(){ await dbSet('state', state); }

  function toast(message, actionText, action) {
    const el = document.createElement('div'); el.className='toast';
    el.innerHTML = `<span>${esc(message)}</span>${actionText ? `<button type="button">${esc(actionText)}</button>` : ''}`;
    if(actionText) $('.toast button', el).addEventListener('click',()=>{ action(); el.remove(); });
    $('#toast-root').appendChild(el);
    if(!actionText) setTimeout(()=>el.remove(),3500);
    return el;
  }

  function navigate(view) {
    $$('.view').forEach(v=>v.classList.remove('active-view'));
    $(`#view-${view}`)?.classList.add('active-view');
    $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
    const titles={dashboard:'الرئيسية',products:'البضاعة',invoices:'الفواتير',customers:'الزبائن',slider:'السلايدر',companies:'الشركات',ai:'مساعد التيسير',settings:'الإعدادات'};
    $('#page-title').textContent=titles[view]||'';
    if(view==='dashboard') renderHomeFeatures();
  }

  function armSlideControls(root){ if(!root) return; clearTimeout(root.__controlsTimer); root.classList.remove('controls-dim'); root.__controlsTimer=setTimeout(()=>root.classList.add('controls-dim'),1000); root.querySelectorAll('[data-sl],[data-carousel-dir],[data-carousel-index]').forEach(b=>b.addEventListener('click',()=>{root.classList.remove('controls-dim');clearTimeout(root.__controlsTimer);root.__controlsTimer=setTimeout(()=>root.classList.add('controls-dim'),1000);})); }

  function renderHomeFeatures(){
    const hd=$('#home-date'); if(hd) hd.textContent=new Date().toLocaleDateString('en-GB');
    const slides=[...state.slides].sort((a,b)=>(a.order||0)-(b.order||0)); const root=$('#home-slider');
    if(!slides.length){root.innerHTML='<div class="empty">لا توجد مختارات بعد. أضف أول شريحة من قسم مختارات التيسير.</div>';return;}
    const s=slides[(Number(root.dataset.index)||0) % slides.length]||slides[0], pr=state.products.find(x=>x.id===s.productId);
    root.innerHTML=`<div class="slide-live">${s.image?`<img class="slide-live-bg" src="${s.image}" alt=""><img class="slide-live-main" src="${s.image}" alt="">`:'<div class="empty" style="height:100%;display:grid;place-items:center">📦 لا توجد صورة</div>'}<div class="taysir-watermark">التيسير</div><button class="sl-pill sl-top" data-go="slider">✦ مختارات التيسير</button><button class="sl-arrow sl-r" data-sl="-1" aria-label="السابق">›</button><button class="sl-arrow sl-l" data-sl="1" aria-label="التالي">‹</button><div class="sl-bottom"><span class="sl-pill sl-name">${esc(s.title||'—')}</span>${pr?`<span class="sl-pill sl-price">$${money(pr.priceUsd)}</span>`:''}<span class="sl-pill sl-desc">${esc(s.subtitle||'')}</span></div></div>`;
    root.querySelectorAll('[data-sl]').forEach(b=>b.onclick=e=>{e.stopPropagation();root.dataset.index=(((Number(root.dataset.index)||0)+Number(b.dataset.sl))%slides.length+slides.length)%slides.length;renderHomeFeatures();});
    armSlideControls(root);
    if(!window.__slTimer)window.__slTimer=setInterval(()=>{const r=$('#home-slider');if(r&&state.slides.length>1&&document.visibilityState==='visible'){r.dataset.index=((Number(r.dataset.index)||0)+1)%state.slides.length;renderHomeFeatures();}},7000);
  }

  function renderCompanies(){
    const root=$('#companies-grid'); if(!root)return;
    root.innerHTML=state.companies?.length?state.companies.map(c=>`<article class="company-card">${c.logo?`<img class="company-logo" src="${c.logo}" alt="">`:'<div class="company-logo" style="display:grid;place-items:center">◇</div>'}<h3>${esc(c.name)}</h3><p class="muted">${esc(c.info||'')}</p><button class="small-btn danger" data-delete-company="${c.id}">حذف</button></article>`).join(''):'<div class="empty" style="grid-column:1/-1">أضف أول شركة أو علامة تجارية.</div>';
  }

  function localProductSuggestions(name,info){
    const text=(name+' '+info).trim();
    const category=/علب|تخزين|مطربان|حافظة/.test(text)?'أدوات منزلية':/كوب|كاسات|نايلون|أكياس|بلاستيك/.test(text)?'بلاستيك ومستلزمات':'غير مصنف';
    return {name:name||'منتج جديد',category,description:`${name||'المنتج'} — خيار عملي للاستخدام اليومي، مقدم بأسلوب أنيق وواضح من مركز التيسير. ${info||''}`.trim(),keywords:[name,'مركز التيسير','منتجات',category].filter(Boolean).join('، '),shortTitle:name||'منتج جديد',marketing:`اقتراح تسويقي يبرز فائدة ${name||'المنتج'} واستخدامه بطريقة مختصرة وجذابة.`};
  }
  let sug=null;
  function updateBulk(){ const c=$('#bulk-count'); if(c) c.textContent=`${selIds.size} محدد`; }
  function fillAiSelect(){ const s=$('#ai-product-select'); if(!s) return; const v=s.value; s.innerHTML='<option value="">— اختر منتجاً (أو اتركه للمساعد ليقترح من البضاعة) —</option>'+state.products.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join(''); s.value=v; }
  function loadImg(src){ return new Promise(r=>{ if(!src) return r(null); const i=new Image(); i.onload=()=>r(i); i.onerror=()=>r(null); i.src=src; }); }
  function wrapText(x,t,w){ const ws=String(t).split(' '),ls=[]; let l=''; ws.forEach(k=>{const n=l?l+' '+k:k; if(x.measureText(n).width>w&&l){ls.push(l);l=k;}else l=n;}); if(l) ls.push(l); return ls.slice(0,3); }
  async function makeCard(p,v){
    const W=1280,H=720,c=document.createElement('canvas'); c.width=W; c.height=H; const x=c.getContext('2d'); x.direction='rtl'; x.textAlign='right';
    const pal=[['#0b0b0c','#3a2d0f','#f2c14e','#ffffff'],['#16110b','#5b4215','#f0d38d','#ffffff'],['#0d0d0e','#25201a','#e4bd68','#ffffff']][v%3];
    const g=x.createLinearGradient(0,0,W,H); g.addColorStop(0,pal[0]); g.addColorStop(1,pal[1]); x.fillStyle=g; x.fillRect(0,0,W,H);
    x.globalAlpha=.16; x.fillStyle=pal[2]; x.beginPath(); x.arc(v%2?180:1090,v===2?600:120,320,0,7); x.fill(); x.globalAlpha=1;
    const bs=460,by=105,bx=v%2?65:W-65-bs,img=await loadImg(p.image);
    x.fillStyle='rgba(255,255,255,.10)'; x.beginPath(); x.roundRect(bx,by,bs,bs,36); x.fill();
    if(img){ const sc=Math.min((bs-40)/img.width,(bs-40)/img.height); x.drawImage(img,bx+(bs-img.width*sc)/2,by+(bs-img.height*sc)/2,img.width*sc,img.height*sc); }
    const tr=v%2?W-70:bx-50; x.fillStyle=pal[2]; x.font='bold 34px Tahoma,Arial,sans-serif'; x.fillText('✦ التيسير',tr,120);
    x.fillStyle=pal[3]; x.font='bold 58px Tahoma,Arial,sans-serif'; wrapText(x,p.name,610).forEach((l,i)=>x.fillText(l,tr,250+i*74));
    x.fillStyle=pal[2]; x.font='bold 84px Tahoma,Arial,sans-serif'; x.fillText('$'+money(p.priceUsd),tr,535);
    x.fillStyle=pal[3]; x.globalAlpha=.8; x.font='30px Tahoma,Arial,sans-serif'; x.fillText(p.category||'مركز التيسير',tr,595); x.globalAlpha=1;
    return c.toDataURL('image/jpeg',.88);
  }
  function readEdits(item){
    if(!item?.editing) return;
    $('#ai-result-body')?.querySelectorAll(`[data-queue-field="${item.id}"]`).forEach(el=>{ item.data[el.dataset.field]=el.value; });
  }
  function queueCompanyFor(p){ return state.companies.find(c=>c.name===p.company)||state.companies.find(c=>c.name===p.category); }
  function sourceImageFor(p){ return p?.sourceImage || (p?.sourcePageId ? (state.sourcePages?.[p.sourcePageId]||'') : '') || p?.image || ''; }
  function geminiPrompt(p, variation, type='product'){
    const company=queueCompanyFor(p); const brand=company?.name||'مركز التيسير';
    return `Create a premium commercial product photograph for مركز التيسير. Use the provided product/reference image as the source of truth. Identify the exact product named "${p.name}" from the reference and preserve its packaging, proportions, colors, label, logo, and visible product details without inventing or replacing the product. Place it on an elegant warm wooden table/pedestal with cinematic soft lighting, realistic shadows, subtle black, white and gold brand styling, and a sophisticated softly blurred background inspired by a premium modern retail center. The brand atmosphere should feel like "${brand}" and "التيسير" without covering or changing the product label. ${variation}. IMPORTANT: output ONLY the clean product photograph. Do NOT include a phone frame, status bar, time, battery, Wi‑Fi, navigation arrows, carousel dots, buttons, UI, price card, or text overlays.`;
  }
  async function generateProductImage(p, variation='', type='product'){
    const src=sourceImageFor(p); if(!src) return {ok:false,error:'هذا المنتج لا يملك صورة مصدر من النشرة/المكتبة بعد.'};
    if(!state.geminiConfigured || !window.taysirAPI?.generateGeminiImage) return {ok:false,error:'احفظ مفتاح Gemini من قسم مساعد التيسير أولاً.'};
    const company=queueCompanyFor(p); const images=[src]; if(company?.logo) images.push(company.logo);
    return await window.taysirAPI.generateGeminiImage({images,aspect:type==='slider'?'16:9':'4:5',prompt:geminiPrompt(p,variation+(type==='slider'?' Compose it as a wide 16:9 hero banner: the product large and sharp on one side, calm soft empty space on the other side, rich premium backdrop.':''))});
  }
  function addQueueItem(item){ state.reviewQueue=Array.isArray(state.reviewQueue)?state.reviewQueue:[]; state.reviewQueue.push(item); }
  function renderAIQueue(){
    const root=$('#ai-result-body'); if(!root)return;
    const q=state.reviewQueue||[];
    if(!q.length){root.innerHTML='<div class="empty">لا توجد اقتراحات بانتظار المراجعة. اختر منتجاً ثم اضغط «أنشئ اقتراحات».</div>';return;}
    const top=`<div class="review-toolbar"><strong>${q.length} اقتراح${q.length>1?'ات':''} بانتظارك</strong><div><button class="secondary-btn" id="ai-approve-all" type="button">✓ اعتماد الكل</button><button class="secondary-btn" id="ai-reject-all" type="button">✕ رفض الكل</button></div></div>`;
    root.innerHTML=top+q.map(item=>{
      const d=item.data||{}; const fields=Object.entries(d).map(([k,v])=>item.editing?`<label>${esc(k)}<textarea rows="2" data-queue-field="${item.id}" data-field="${esc(k)}">${esc(v)}</textarea></label>`:`<p><b>${esc(k)}:</b> ${esc(v)}</p>`).join('');
      const img=item.image||sourceImageFor(item.product);
      return `<article class="review-card" data-review-id="${item.id}"><div class="review-media">${img?`<img src="${img}" alt="${esc(item.product?.name||'')}">`:'<div class="empty">لا توجد صورة مصدر</div>'}</div><div class="review-copy"><div class="review-head"><div><span class="section-kicker">${item.type==='slider'?'فكرة سلايدر':'اقتراح منتج'}</span><h4>${esc(item.product?.name||'منتج')}</h4></div><span class="review-status">قيد المراجعة</span></div>${fields}<div class="review-actions"><button class="primary-btn" data-review-approve="${item.id}" type="button">✓ اعتماد</button><button class="secondary-btn" data-review-edit="${item.id}" type="button">${item.editing?'💾 حفظ التعديل':'✎ تعديل'}</button><button class="secondary-btn" data-review-redesign="${item.id}" type="button">✨ إعادة تصميم الصورة</button><button class="secondary-btn" data-review-add-slide="${item.id}" type="button">＋ إضافة للسلايدر</button><button class="secondary-btn danger-text" data-review-reject="${item.id}" type="button">✕ رفض</button></div></div></article>`;
    }).join('');
  }
  function suggestionKey(s,p){ return `${p?.id||s.productId}|${String(s.title||'').trim()}|${String(s.description||'').trim()}|${String(s.imageDirection||'').trim()}`.toLowerCase(); }
  function rememberSuggestions(list){ state.suggestionHistory=Array.isArray(state.suggestionHistory)?state.suggestionHistory:[]; const keys=list.map(x=>suggestionKey(x,x.product)); state.suggestionHistory.push(...keys); state.suggestionHistory=[...new Set(state.suggestionHistory)].slice(-80); }
  async function createReviewSuggestions(type){
    if(!state.products.length){toast('أضف منتجات أولاً.');return;}
    const selected=$('#ai-product-select').value;
    const products=selected?[state.products.find(p=>p.id===selected)].filter(Boolean):[...state.products].sort((a,b)=>b.createdAt-a.createdAt).slice(0,4);
    const info=$('#ai-product-info').value.trim(); if(!products.length){toast('اختر منتجاً صحيحاً.');return;}
    state.reviewQueue=state.reviewQueue||[]; state.suggestionHistory=Array.isArray(state.suggestionHistory)?state.suggestionHistory:[];
    let suggestions=[];
    if(state.geminiConfigured && window.taysirAPI?.generateGeminiText){
      const catalog=products.map(p=>({id:p.id,name:p.name,company:p.company||p.category||'',priceUsd:p.priceUsd||0,description:p.description||'',hasSourceImage:!!sourceImageFor(p)}));
      const prompt=`أنت مساعد التسويق الرسمي لمركز التيسير. أنشئ بالضبط 4 اقتراحات فقط، مختلفة عن بعضها وعن هذه المفاتيح السابقة: ${JSON.stringify(state.suggestionHistory.slice(-30))}. لا تكرر عنواناً أو وصفاً أو اتجاه تصوير سبق استخدامه. استخدم فقط معلومات الكتالوج ولا تخترع مواصفات. هوية التيسير: أسود وذهبي وأبيض، خشب فاخر، إضاءة سينمائية ناعمة، المنتج هو البطل. لا تضع واجهة هاتف داخل صورة المنتج. نوع الطلب: ${type==='product'?'محتوى وتسويق للمنتجات':'أفكار سلايدر'}. ملاحظات: ${info||'لا توجد'}. الكتالوج: ${JSON.stringify(catalog)}. أرجع JSON فقط: {"suggestions":[{"productId":"...","title":"...","description":"...","marketing":"...","imageDirection":"..."}]} imageDirection يجب أن يصف صورة نظيفة للمنتج فقط بلا وقت أو بطارية أو أزرار أو إطار موبايل.`;
      const r=await window.taysirAPI.generateGeminiText({prompt}); if(r.ok&&Array.isArray(r.data?.suggestions)) suggestions=r.data.suggestions.slice(0,4); else toast('تعذر أخذ الاقتراحات من Gemini، سأستخدم الاقتراحات المحلية كبديل.');
    }
    if(suggestions.length<4){
      const variations=['لقطة أمامية فاخرة وبسيطة مع ضوء ذهبي ناعم.','لقطة ثلاثية الأرباع مع خشب طبيعي وخلفية سوداء هادئة.','لقطة قريبة تبرز تفاصيل المنتج مع عمق ميدان سينمائي.','مشهد عرض راقٍ على طاولة خشبية مع ضوء جانبي ناعم.','زاوية منخفضة فاخرة مع انعكاس ضوء خفيف على العبوة.','لقطة استوديو نظيفة مع خلفية داكنة ووهج ذهبي خفيف.','لقطة جانبية متوازنة مع ظلال واقعية وعمق ميدان واضح.','مشهد فاخر هادئ يركز على شكل المنتج وتغليفه دون نصوص إضافية.'];
      let vi=0; for(const p of products){ if(suggestions.length>=4) break; const base=localProductSuggestions(p.name,info||p.description||''); while(suggestions.length<4&&vi<variations.length){const x={productId:p.id,title:`${p.name} — ${['عرض فاخر','هوية التيسير','لقطة احترافية','مختار التيسير'][suggestions.length]}`,description:base.description,marketing:base.marketing,imageDirection:variations[vi++]}; if(!state.suggestionHistory.includes(suggestionKey(x,p))&&!suggestions.some(y=>suggestionKey(y,p)===suggestionKey(x,p))) suggestions.push(x);}}
    }
    // إزالة أي تكرار وإجبار العدد على 4
    const unique=[]; const seen=new Set([...state.suggestionHistory]); for(const sg of suggestions){const p=products.find(x=>x.id===sg.productId)||products[0]; if(!p)continue; const k=suggestionKey(sg,p); if(seen.has(k))continue; seen.add(k); unique.push(sg); if(unique.length===4)break;}
    if(unique.length<4){toast('لا يوجد 4 اقتراحات جديدة كافية حالياً. أعد المحاولة بعد تغيير المنتج أو الملاحظات.');return;}
    const added=[];
    for(const sg of unique){ const p=products.find(x=>x.id===sg.productId)||products[0]; const data=type==='product'?{name:sg.title||p.name,category:p.category||'',description:sg.description||'',marketing:sg.marketing||''}:{العنوان:sg.title||p.name,الوصف:sg.description||sg.marketing||''}; const item={id:uid('review'),type,data,product:p,image:'',editing:false,status:'pending',imageDirection:sg.imageDirection||''}; addQueueItem(item); added.push({ ...sg, product:p }); renderAIQueue(); if(sourceImageFor(p)&&state.geminiConfigured){const r=await generateProductImage(p,sg.imageDirection||'لقطة أساسية فاخرة مناسبة لهوية مركز التيسير.',type);if(r.ok)item.image=r.image;else toast('تعذر توليد الصورة: '+(r.error||'خطأ غير معروف'));renderAIQueue();}}
    rememberSuggestions(added); await persist(); renderAIQueue(); toast(`تمت إضافة 4 اقتراحات جديدة إلى قائمة المراجعة.`);
  }
  async function approveReview(id){
    const item=(state.reviewQueue||[]).find(x=>x.id===id); if(!item)return; readEdits(item);
    if(item.type==='product'){
      const p=state.products.find(x=>x.id===item.product?.id); if(p){Object.assign(p,{description:item.data.description||p.description,marketing:item.data.marketing||p.marketing,aiImage:item.image||p.aiImage||'',image:item.image||p.image,updatedAt:Date.now()});}
    }else{
      state.slides.unshift({id:uid('slide'),title:item.data['العنوان']||item.product?.name||'',subtitle:item.data['الوصف']||'',image:item.image||sourceImageFor(item.product),order:0,createdAt:Date.now(),productId:item.product?.id||null});
      state.slides=state.slides.slice(0,5); state.slides.forEach((x,i)=>x.order=i);
    }
    state.reviewQueue=state.reviewQueue.filter(x=>x.id!==id); await persist(); renderAll(); renderAIQueue(); toast('تم اعتماد الاقتراح وتنفيذه.');
  }
  async function redesignReview(id){
    const item=(state.reviewQueue||[]).find(x=>x.id===id); if(!item)return; const btn=$(`[data-review-redesign="${id}"]`); if(btn){btn.disabled=true;btn.textContent='⏳ جاري التصميم…';}
    const p=item.product; const variation=['إضاءة أكثر دفئاً مع انعكاس ذهبي خفيف.','زاوية تصوير مختلفة مع خلفية سوداء ناعمة.','مشهد أكثر فخامة مع خشب طبيعي وإضاءة استوديو.'][Math.floor(Math.random()*3)];
    const r=await generateProductImage(p,variation); if(r.ok){item.image=r.image;await persist();renderAIQueue();toast('تمت إعادة تصميم الصورة.');}else{if(btn){btn.disabled=false;btn.textContent='✨ إعادة تصميم الصورة';}toast(r.error);}
  }
  function renderAISuggestion(data,title,kind,prods){ const p=prods?.[0]; if(p){addQueueItem({id:uid('review'),type:kind,data:{...data},product:p,image:'',editing:false,status:'pending'});renderAIQueue();persist();} }

  function openCompanyModal(){
    modal({title:'إضافة شركة أو علامة تجارية',subtitle:'الشعار اختياري ويمكن استبداله لاحقاً.',body:`<div class="form-grid"><label>اسم الشركة<input name="name" required></label><label class="full-row">معلومات مختصرة<textarea name="info" rows="3"></textarea></label><div class="full-row upload-zone"><img id="company-preview" style="display:none" alt=""><div class="upload-label">🏷️ ارفع شعار الشركة<br><small>PNG / JPG / WEBP · اختياري</small></div><input id="company-logo" type="file" accept="image/png,image/jpeg,image/webp"></div></div>`,onSubmit:async form=>{const d=new FormData(form);let logo='';const f=$('#company-logo').files[0];if(f)logo=await fileToDataUrl(f);state.companies.push({id:uid('company'),name:String(d.get('name')).trim(),info:String(d.get('info')).trim(),logo});await persist();closeModal();renderCompanies();toast('تم حفظ الشركة.');}});
    $('#company-logo').onchange=async e=>{try{const u=await fileToDataUrl(e.target.files[0]);if(u){$('#company-preview').src=u;$('#company-preview').style.display='block';$('.upload-label').style.display='none';}}catch(err){toast(err.message)}};
  }

  function renderAll(){ const mg=$('#manager-greeting'); if(mg) mg.textContent=state.managerName?`المدير ${state.managerName}`:'المدير'; renderStats(); renderDashboard(); renderProducts(); renderInvoices(); renderCustomers(); renderSlides(); renderSettings(); renderCarousel(); renderHomeFeatures(); renderCompanies(); fillAiSelect(); renderAIQueue(); if($('#gemini-key')) $('#gemini-key').value=''; if($('#gemini-status')) $('#gemini-status').textContent=state.geminiConfigured?'✓ Gemini محفوظ بشكل آمن على هذا الجهاز':'لم يتم إعداد Gemini بعد'; }
  function renderStats(){
    $('#stat-products').textContent=money(state.products.length); $('#stat-invoices').textContent=money(state.invoices.length); $('#stat-customers').textContent=money(state.customers.length);
    $('#exchange-top').textContent=state.exchangeRate?money(state.exchangeRate):'—';
  }

  function renderDashboard(){
    const b=state.business||{}; $('#home-address').textContent=b.address||'—'; $('#home-orders-time').textContent=(b.ordersOpen||'09:00')+' → '+(b.ordersClose||'18:00');
    [['#home-sham-cash-barcode',b.shamCashBarcode],['#home-channel-barcode',b.channelBarcode]].forEach(([sel,src])=>{const el=$(sel);if(el){el.src=src||'';el.style.display=src?'block':'none';}});
    const lp=$('#latest-products'); const li=$('#latest-invoices');
    const products=[...state.products].sort((a,b)=>b.createdAt-a.createdAt).slice(0,5);
    lp.innerHTML=products.length?products.map(p=>`<div class="mini-product"><div class="left"><img class="thumb" src="${p.image||''}" alt=""><div><strong>${esc(p.name)}</strong><small>${esc(p.category||'بدون تصنيف')}</small></div></div><span class="preview-price">$${money(p.priceUsd)}</span></div>`).join(''):'<div class="empty">لم تتم إضافة منتجات بعد.</div>';
    const inv=[...state.invoices].sort((a,b)=>b.createdAt-a.createdAt).slice(0,5);
    li.innerHTML=inv.length?inv.map(i=>`<div class="mini-invoice"><div class="left"><div><strong>${esc(i.customerName)}</strong><small>${esc(i.shop||'')}</small></div></div><span>${money(i.totalUsd)} $</span></div>`).join(''):'<div class="empty">لا توجد فواتير بعد.</div>';
  }

  function renderProducts(){
    const cats=[...new Set(['الكل',...state.products.map(p=>p.category).filter(Boolean)])];
    $('#category-filters').innerHTML=cats.map(c=>`<button class="filter-btn ${activeCategory===c?'active':''}" data-category="${esc(c)}">${esc(c)}</button>`).join('');
    const q=($('#product-search')?.value||'').trim().toLowerCase();
    const products=state.products.filter(p=>activeCategory==='الكل'||p.category===activeCategory).filter(p=>!q||`${p.name} ${p.code||''} ${p.category||''}`.toLowerCase().includes(q)).sort((a,b)=>b.createdAt-a.createdAt);
    $('#products-grid').innerHTML=products.length?products.map(p=>`<article class="p-row"><label class="p-img" title="${p.image?'تغيير الصورة':'إضافة صورة'}">${p.image?`<img src="${p.image}" alt="">`:'<span>＋</span>'}<input type="file" accept="image/png,image/jpeg,image/webp" data-img-for="${p.id}" hidden></label><div class="p-info"><div class="p-name">${esc(p.name)}</div><div class="p-meta">${esc(p.category||'بدون شركة')}${p.code?` · ${esc(p.code)}`:''}</div></div><div class="p-price"><b>$${money(p.priceUsd)}</b><small>${money(p.priceSyp)} ل.س</small></div><div class="p-actions"><button class="small-btn" data-edit-product="${p.id}">تعديل</button><button class="small-btn" data-camera-for="${p.id}">📷 تصوير</button><button class="small-btn danger" data-delete-product="${p.id}">حذف</button></div><label class="p-sel"><input type="checkbox" data-sel="${p.id}" ${selIds.has(p.id)?'checked':''}></label></article>`).join(''):'<div class="empty">لا توجد نتائج. جرّب كلمة أخرى أو أضف منتجاً جديداً.</div>';
    visibleIds=products.map(p=>p.id); updateBulk();
  }

  function renderInvoices(){
    const root=$('#invoices-list');
    if(!state.invoices.length){root.innerHTML='<div class="empty">لا توجد فواتير بعد. ابدأ بإنشاء أول فاتورة.</div>';return;}
    root.innerHTML=[...state.invoices].sort((a,b)=>b.createdAt-a.createdAt).map(i=>{
      const statusClass=i.status==='تم التسليم'?'done':i.status==='جاهز'?'ready':'pending';
      return `<article class="invoice-card" data-invoice-card="${i.id}"><div class="invoice-summary" data-toggle-invoice="${i.id}"><div class="invoice-customer"><strong>${esc(i.customerName)}</strong><small>${esc(i.shop||'بدون محل')} · ${esc(i.phone||'بدون رقم')}</small></div><div><small>التاريخ</small><strong>${esc(i.date||'')}</strong></div><div><span class="status ${statusClass}">${esc(i.status)}</span></div><div>⌄</div></div><div class="invoice-details"><table class="invoice-table"><thead><tr><th>المنتج</th><th>الكمية</th><th>سعر الإفرادي</th><th>الإجمالي</th></tr></thead><tbody>${i.items.map(it=>`<tr><td>${esc(it.name)}</td><td>${money(it.qty)}</td><td>$${money(it.priceUsd)}</td><td>$${money(it.qty*it.priceUsd)}</td></tr>`).join('')}</tbody></table><div class="invoice-total"><span>المجموع: $${money(i.totalUsd)}</span><span>${money(i.totalSyp)} ل.س</span></div><div class="invoice-tools"><button class="small-btn" data-print-invoice="${i.id}">🖨️ طباعة</button><button class="small-btn" data-share-invoice="${i.id}">📤 مشاركة</button><button class="small-btn danger" data-delete-invoice="${i.id}">🗑️ حذف</button></div></div></article>`;
    }).join('');
  }

  function renderCustomers(){
    const root=$('#customers-grid');
    root.innerHTML=state.customers.length?state.customers.map(c=>`<div class="customer-card"><h3>${esc(c.name)}</h3><p>${esc(c.shop||'')}</p><p>☎ ${esc(c.phone||'—')}</p><p>${state.invoices.filter(i=>i.customerId===c.id).length} فاتورة</p></div>`).join(''):'<div class="empty" style="grid-column:1/-1">سيظهر الزبائن هنا تلقائياً عند إنشاء الفواتير.</div>';
  }

  function renderCarousel(){
    const root=$('#slider-preview'); if(!root)return;
    const slides=[...state.slides].sort((a,b)=>(a.order||0)-(b.order||0));
    if(!slides.length){root.innerHTML='<div class="carousel-empty">أضف أول شريحة لتظهر هنا</div>';return;}
    let idx=Math.max(0,Math.min(Number(root.dataset.index)||0,slides.length-1));root.dataset.index=idx;const s=slides[idx];
    root.innerHTML=`<div class="carousel-shell"><div class="carousel-visual">${s.image?`<img class="carousel-bg" src="${s.image}" alt=""><img class="carousel-main" src="${s.image}" alt="${esc(s.title||'')}" loading="lazy">`:'<div class="carousel-empty">لا توجد صورة</div>'}<div class="taysir-watermark">التيسير</div><button class="carousel-arrow right" type="button" data-carousel-dir="-1" aria-label="السابق">‹</button><button class="carousel-arrow left" type="button" data-carousel-dir="1" aria-label="التالي">›</button></div><div class="carousel-info"><span class="section-kicker">مختارات التيسير</span><h2>${esc(s.title||'بدون عنوان')}</h2><p>${esc(s.subtitle||'أضف وصفاً قصيراً للشريحة')}</p><div class="carousel-meta"><span>${idx+1} / ${slides.length}</span><span>${s.productId?'مرتبط بمنتج':'شريحة مستقلة'}</span></div><div class="carousel-dots">${slides.map((_,i)=>`<button type="button" class="${i===idx?'active':''}" data-carousel-index="${i}" aria-label="الشريحة ${i+1}"></button>`).join('')}</div></div></div>`;
    armSlideControls(root);
  }
  function renderSlides(){
    const root=$('#slides-grid');
    root.innerHTML=state.slides.length?[...state.slides].sort((a,b)=>a.order-b.order).map((s,idx)=>`<article class="slide-card"><img src="${s.image||''}" alt="${esc(s.title)}"><div class="slide-body"><h3>${esc(s.title||'بدون عنوان')}</h3><p>${esc(s.subtitle||'')}</p><div class="slide-actions"><button class="small-btn" data-edit-slide="${s.id}">تعديل</button><button class="small-btn" data-move-slide="${s.id}" data-dir="up">↑</button><button class="small-btn" data-move-slide="${s.id}" data-dir="down">↓</button><button class="small-btn danger" data-delete-slide="${s.id}">حذف</button></div></div></article>`).join(''):'<div class="empty" style="grid-column:1/-1">لا توجد شرائح. أضف أول شريحة من الزر أعلاه.</div>';
  }

  function renderSettings(){
    if($('#setting-manager-name')) $('#setting-manager-name').value=state.managerName||'';
    $('#setting-exchange').value=state.exchangeRate||''; $('#exchange-source').textContent=state.exchangeFetchedAt?'تحديث تلقائي: '+new Date(state.exchangeFetchedAt).toLocaleTimeString('en-US'):'لم يتم التحديث التلقائي بعد'; $('#setting-direction').value=state.direction; $('#undo-delete').checked=!!state.undoDelete;
    const b=state.business||{}; $('#setting-address').value=b.address||''; $('#setting-orders-open').value=b.ordersOpen||'09:00'; $('#setting-orders-close').value=b.ordersClose||'18:00';
    [['sham-cash','shamCashBarcode'],['channel','channelBarcode']].forEach(([k,key])=>{const el=$(`#setting-${k}-barcode`); if(el) el.value=''; const p=$(`#${k}-barcode-preview`); if(p){p.src=b[key]||'';p.style.display=b[key]?'block':'none';}});
    $('#contacts-list').innerHTML=state.contacts.map((c,i)=>`<div class="contact-row"><input data-contact-name="${i}" placeholder="اسم صاحب الرقم" value="${esc(c.name)}"><input data-contact-phone="${i}" placeholder="رقم الهاتف" value="${esc(c.phone)}"><button class="remove-row" data-remove-contact="${i}">×</button></div>`).join('');
    $('#groups-list').innerHTML=state.groups.map((g,i)=>`<div class="group-row"><input data-group-name="${i}" placeholder="اسم المجموعة" value="${esc(g.name)}"><input data-group-url="${i}" placeholder="رابط المجموعة" value="${esc(g.url)}"><button class="remove-row" data-remove-group="${i}">×</button></div>`).join('');
  }

  function fileToDataUrl(file){return new Promise((resolve,reject)=>{if(!file)return resolve(''); if(!file.type.startsWith('image/'))return reject(new Error('الملف ليس صورة.')); if(file.size>8*1024*1024)return reject(new Error('حجم الصورة أكبر من 8MB.')); const r=new FileReader(); r.onload=()=>resolve(r.result); r.onerror=()=>reject(new Error('تعذر قراءة الصورة.')); r.readAsDataURL(file);});}

  function stopCamera(){ if(cameraStream){ cameraStream.getTracks().forEach(t=>t.stop()); cameraStream=null; } }
  function closeModal(){ stopCamera(); cameraImage=''; $('#modal-root').innerHTML=''; }
  function modal({title,subtitle='',body,submitText='حفظ',onSubmit}){
    $('#modal-root').innerHTML=`<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true"><h2>${esc(title)}</h2><div class="modal-sub">${esc(subtitle)}</div><form id="modal-form">${body}<div class="modal-actions"><button type="button" class="secondary-btn" id="modal-cancel">إلغاء</button><button class="primary-btn" type="submit">${esc(submitText)}</button></div></form></div></div>`;
    $('#modal-cancel').onclick=closeModal; $('.modal-backdrop').addEventListener('click',e=>{if(e.target.classList.contains('modal-backdrop'))closeModal()});
    $('#modal-form').addEventListener('submit',async e=>{e.preventDefault();try{await onSubmit(e.currentTarget)}catch(err){toast(err.message||'حدث خطأ غير متوقع.')}});
  }

  function openProductModal(product=null,prefill=null,autoCamera=false){
    const p=product?Object.assign({},product,prefill||{}):prefill||{name:'',code:'',category:'',priceUsd:'',priceSyp:'',image:''};
    cameraImage='';
    modal({title:product?'تعديل المنتج':'إضافة بضاعة جديدة',subtitle:'لكل منتج صورة خاصة به. يمكنك اختيار صورة من الجهاز أو التقاطها مباشرة بالكاميرا.',body:`<div class="form-grid"><label>اسم المنتج<input name="name" required value="${esc(p.name)}"></label><label>الكود<input name="code" value="${esc(p.code||'')}"></label><label>التصنيف<input name="category" list="category-list" required value="${esc(p.category||'')}"><datalist id="category-list">${[...new Set(state.products.map(x=>x.category).filter(Boolean))].map(c=>`<option value="${esc(c)}">`).join('')}</datalist></label><label>السعر بالدولار<input name="priceUsd" lang="en" dir="ltr" inputmode="decimal" type="number" min="0" step="0.01" required value="${esc(p.priceUsd)}"></label><label>السعر بالليرة<input name="priceSyp" lang="en" dir="ltr" inputmode="numeric" type="number" min="0" step="1" value="${esc(p.priceSyp)}"></label><label class="full-row">وصف مختصر<textarea name="description" rows="3">${esc(p.description||'')}</textarea></label><div class="full-row upload-zone product-upload" id="product-upload"><img id="product-preview" src="${p.image||''}" style="${p.image?'display:block':'display:none'}" alt=""><div class="upload-label" style="${p.image?'display:none':''}">🖼️ صورة المنتج<br><small>JPG / PNG / WEBP · حتى 8MB</small></div><input id="product-image" type="file" accept="image/png,image/jpeg,image/webp" hidden><div class="upload-actions"><button type="button" class="secondary-btn" id="product-choose-image">📁 استيراد من الصور/المعرض</button><button type="button" class="primary-btn" id="product-camera">📷 التقاط بالكاميرا</button></div><div id="product-camera-panel" class="camera-panel" hidden><video id="product-camera-video" autoplay playsinline></video><div><button type="button" class="primary-btn" id="product-take-photo">التقاط الصورة</button><button type="button" class="secondary-btn" id="product-stop-camera">إغلاق الكاميرا</button></div></div></div></div>`,onSubmit:async form=>{
      const data=new FormData(form); let image=cameraImage||p.image||''; const file=$('#product-image').files[0]; if(file) image=await fileToDataUrl(file);
      const item={id:p.id||uid('prod'),name:String(data.get('name')).trim(),code:String(data.get('code')).trim(),category:String(data.get('category')).trim(),priceUsd:Number(data.get('priceUsd'))||0,priceSyp:Number(data.get('priceSyp'))||0,description:String(data.get('description')).trim(),image,sourceImage:p.sourceImage||image,createdAt:p.createdAt||Date.now(),updatedAt:Date.now()};
      if(!item.name)throw new Error('اسم المنتج مطلوب.');
      if(product){const idx=state.products.findIndex(x=>x.id===product.id);if(idx<0)throw new Error('المنتج غير موجود.');state.products[idx]=item;}else{state.products.push(item);autoAddLatestSlide(item);}
      await persist();closeModal();renderAll();toast(product?'تم تعديل المنتج بنجاح.':'تمت إضافة المنتج بنجاح.');
    }});
    $('#product-choose-image').onclick=()=>$('#product-image').click();
    $('#product-image').addEventListener('change',async e=>{try{const url=await fileToDataUrl(e.target.files[0]);if(url){cameraImage='';$('#product-preview').src=url;$('#product-preview').style.display='block';$('.upload-label').style.display='none';}}catch(err){e.target.value='';toast(err.message)}});
    $('#product-camera').onclick=async()=>{try{stopCamera();cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});const panel=$('#product-camera-panel'),video=$('#product-camera-video');panel.hidden=false;video.srcObject=cameraStream;await video.play();}catch(err){toast('تعذر فتح الكاميرا. تأكد من إعطاء البرنامج صلاحية استخدام الكاميرا.');}};
    $('#product-take-photo').onclick=()=>{const video=$('#product-camera-video');if(!video.videoWidth)return toast('انتظر حتى تظهر صورة الكاميرا.');const c=document.createElement('canvas');c.width=video.videoWidth;c.height=video.videoHeight;c.getContext('2d').drawImage(video,0,0);cameraImage=c.toDataURL('image/jpeg',.88);$('#product-preview').src=cameraImage;$('#product-preview').style.display='block';$('.upload-label').style.display='none';stopCamera();$('#product-camera-panel').hidden=true;toast('تم التقاط صورة المنتج.');};
    $('#product-stop-camera').onclick=()=>{stopCamera();$('#product-camera-panel').hidden=true;};
    if(autoCamera) $('#product-camera').click();
  }

  function autoAddLatestSlide(product){
    const slide={id:uid('slide'),title:product.name,subtitle:'✨ منتج جديد',image:product.image,order:Date.now(),productId:product.id,createdAt:Date.now()};
    state.slides.push(slide); state.slides.sort((a,b)=>b.createdAt-a.createdAt); state.slides=state.slides.slice(0,5); state.slides.forEach((s,i)=>s.order=i);
  }

  function openSlideModal(slide=null){
    const s=slide||{title:'',subtitle:'',image:''};
    modal({title:slide?'تعديل شريحة':'إضافة شريحة',subtitle:'يمكنك رفع صورة مستقلة للسلايدر مع عنوان ووصف ورابط اختياري لاحقاً.',body:`<div class="form-grid"><label>عنوان الشريحة<input name="title" value="${esc(s.title)}"></label><label>النص المختصر<input name="subtitle" value="${esc(s.subtitle||'')}"></label><div class="full-row upload-zone"><img id="slide-preview" src="${s.image||''}" style="${s.image?'display:block':'display:none'}" alt=""><div class="upload-label" style="${s.image?'display:none':''}">🖼️ اضغط هنا لرفع صورة السلايدر<br><small>JPG / PNG / WEBP · حتى 8MB</small></div><input id="slide-image" type="file" accept="image/png,image/jpeg,image/webp"></div></div>`,onSubmit:async form=>{
      const data=new FormData(form);let image=s.image||'';const file=$('#slide-image').files[0];if(file)image=await fileToDataUrl(file);
      const item={id:s.id||uid('slide'),title:String(data.get('title')).trim(),subtitle:String(data.get('subtitle')).trim(),image,order:s.order??state.slides.length,createdAt:s.createdAt||Date.now(),productId:s.productId||null};
      if(slide){const idx=state.slides.findIndex(x=>x.id===slide.id);state.slides[idx]=item;}else{state.slides.unshift(item);state.slides=state.slides.slice(0,5);}state.slides.forEach((x,i)=>x.order=i);await persist();closeModal();renderAll();toast('تم حفظ شريحة السلايدر.');
    }});
    $('#slide-image').addEventListener('change',async e=>{try{const url=await fileToDataUrl(e.target.files[0]);if(url){$('#slide-preview').src=url;$('#slide-preview').style.display='block';$('.upload-label').style.display='none';}}catch(err){e.target.value='';toast(err.message)}});
  }

  function openInvoiceModal(){
    modal({title:'فاتورة جديدة',subtitle:'أضف الزبون ثم أضف أصناف الفاتورة والكميات.',body:`<div class="form-grid"><label>اسم الزبون<input name="customerName" required></label><label>المحل / اللقب<input name="shop"></label><label>رقم الهاتف<input name="phone"></label><label>الحالة<select name="status"><option>قيد الانتظار</option><option>قيد التجهيز</option><option>جاهز</option><option>تم التسليم</option></select></label><div class="full-row" id="invoice-items"><div class="item-line" style="display:grid;grid-template-columns:1.7fr .6fr .8fr auto;gap:7px;margin-bottom:8px"><select name="productId" required><option value="">اختر المنتج</option>${state.products.map(p=>`<option value="${p.id}">${esc(p.name)} — $${money(p.priceUsd)}</option>`).join('')}</select><input name="qty" lang="en" dir="ltr" inputmode="numeric" type="number" min="1" value="1"><input name="priceUsd" lang="en" dir="ltr" inputmode="decimal" type="number" min="0" step="0.01" placeholder="السعر"><button type="button" class="remove-row" disabled>×</button></div></div><button type="button" class="secondary-btn" id="add-item-line">＋ إضافة صنف</button></div>`,onSubmit:async form=>{
      const data=new FormData(form);const lines=$$('.item-line',form).map(line=>{const pid=$('[name="productId"]',line).value;const p=state.products.find(x=>x.id===pid);return p?{productId:pid,name:p.name,qty:Number($('[name="qty"]',line).value)||0,priceUsd:Number($('[name="priceUsd"]',line).value)||p.priceUsd}:null}).filter(Boolean);if(!lines.length)throw new Error('أضف صنفاً واحداً على الأقل.');if(lines.some(x=>x.qty<=0))throw new Error('تأكد من الكميات.');
      const totalUsd=lines.reduce((s,x)=>s+x.qty*x.priceUsd,0);const totalSyp=state.exchangeRate?totalUsd*state.exchangeRate:0;const name=String(data.get('customerName')).trim();const shop=String(data.get('shop')).trim();const phone=String(data.get('phone')).trim();let customer=state.customers.find(c=>c.name===name&&c.phone===phone);if(!customer){customer={id:uid('cust'),name,shop,phone,createdAt:Date.now()};state.customers.push(customer);}else{customer.shop=shop||customer.shop;customer.phone=phone||customer.phone;}
      state.invoices.push({id:uid('inv'),customerId:customer.id,customerName:name,shop,phone,status:String(data.get('status')),date:nowText(),createdAt:Date.now(),items:lines,totalUsd,totalSyp});await persist();closeModal();renderAll();toast('تم إنشاء الفاتورة بنجاح.');
    }});
    $('#add-item-line').onclick=()=>{const root=$('#invoice-items');const line=document.createElement('div');line.className='item-line';line.style.cssText='display:grid;grid-template-columns:1.7fr .6fr .8fr auto;gap:7px;margin-bottom:8px';line.innerHTML=`<select name="productId" required><option value="">اختر المنتج</option>${state.products.map(p=>`<option value="${p.id}">${esc(p.name)} — $${money(p.priceUsd)}</option>`).join('')}</select><input name="qty" lang="en" dir="ltr" inputmode="numeric" type="number" min="1" value="1"><input name="priceUsd" lang="en" dir="ltr" inputmode="decimal" type="number" min="0" step="0.01" placeholder="السعر"><button type="button" class="remove-row">×</button>`;root.appendChild(line);$('.remove-row',line).onclick=()=>line.remove();};
    $$('.item-line select').forEach(sel=>sel.addEventListener('change',e=>{const p=state.products.find(x=>x.id===e.target.value);if(p) $('[name="priceUsd"]',e.target.closest('.item-line')).value=p.priceUsd;}));
  }

  function printInvoice(inv){
    const w=window.open('','_blank','width=900,height=800');if(!w){toast('المتصفح منع نافذة الطباعة. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.');return;}
    w.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>فاتورة ${esc(inv.customerName)}</title><style>body{font-family:Arial,sans-serif;padding:35px;color:#111}h1{margin-bottom:4px}.muted{color:#666}table{width:100%;border-collapse:collapse;margin-top:25px}th,td{border:1px solid #ddd;padding:10px;text-align:right}.total{margin-top:20px;font-size:18px;font-weight:bold}</style></head><body><h1>مركز التيسير</h1><div class="muted">فاتورة إلى: ${esc(inv.customerName)} · ${esc(inv.shop||'')}</div><div class="muted">${esc(inv.date||'')}</div><table><thead><tr><th>المنتج</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>${inv.items.map(x=>`<tr><td>${esc(x.name)}</td><td>${money(x.qty)}</td><td>$${money(x.priceUsd)}</td><td>$${money(x.qty*x.priceUsd)}</td></tr>`).join('')}</tbody></table><div class="total">الإجمالي: $${money(inv.totalUsd)}${inv.totalSyp?` — ${money(inv.totalSyp)} ل.س`:''}</div><script>window.onload=()=>window.print();</script></body></html>`);w.document.close();
  }

  async function shareInvoice(inv){
    const text=`فاتورة مركز التيسير\nالزبون: ${inv.customerName}\nالإجمالي: $${money(inv.totalUsd)}${inv.totalSyp?`\nبالليرة: ${money(inv.totalSyp)} ل.س`:''}`;
    if(navigator.share){try{await navigator.share({title:'فاتورة مركز التيسير',text});}catch(e){}}else{await navigator.clipboard?.writeText(text);toast('تم نسخ ملخص الفاتورة للمشاركة.');}
  }

  async function deleteInvoice(id){
    const inv=state.invoices.find(x=>x.id===id);if(!inv)return;if(!confirm(`هل تريد فعلاً حذف فاتورة السيد ${inv.customerName}؟`))return;
    state.invoices=state.invoices.filter(x=>x.id!==id);lastDeletedInvoice=inv;await persist();renderAll();
    if(state.undoDelete){clearTimeout(undoTimer);const t=toast(`تم حذف فاتورة ${inv.customerName}.`,'تراجع',async()=>{state.invoices.push(lastDeletedInvoice);lastDeletedInvoice=null;await persist();renderAll();});undoTimer=setTimeout(()=>{t.remove();lastDeletedInvoice=null;},5000);}
  }

  document.addEventListener('click', async e=>{
    const ra=e.target.closest('[data-review-approve]'); if(ra){await approveReview(ra.dataset.reviewApprove);return;}
    const rr=e.target.closest('[data-review-reject]'); if(rr){state.reviewQueue=state.reviewQueue.filter(x=>x.id!==rr.dataset.reviewReject);await persist();renderAIQueue();toast('تم رفض الاقتراح.');return;}
    const re=e.target.closest('[data-review-edit]'); if(re){const item=state.reviewQueue.find(x=>x.id===re.dataset.reviewEdit);if(item){if(item.editing)readEdits(item);item.editing=!item.editing;renderAIQueue();if(item.editing)toast('عدّل الحقول ثم اضغط حفظ التعديل.');else toast('تم حفظ التعديل داخل قائمة المراجعة.');}return;}
    const rd=e.target.closest('[data-review-redesign]'); if(rd){await redesignReview(rd.dataset.reviewRedesign);return;}
    const ras=e.target.closest('[data-review-add-slide]'); if(ras){const item=state.reviewQueue.find(x=>x.id===ras.dataset.reviewAddSlide);if(item){readEdits(item);state.slides.unshift({id:uid('slide'),title:item.data['العنوان']||item.data.name||item.product?.name||'',subtitle:item.data['الوصف']||item.data.description||item.data.marketing||'',image:item.image||sourceImageFor(item.product),order:0,createdAt:Date.now(),productId:item.product?.id||null});state.slides=state.slides.slice(0,5);state.slides.forEach((x,i)=>x.order=i);await persist();renderAll();toast('تمت إضافة الاقتراح إلى السلايدر.');}return;}
    if(e.target.closest('#ai-approve-all')){for(const item of [...(state.reviewQueue||[])]) await approveReview(item.id);return;}
    if(e.target.closest('#ai-reject-all')){if(!confirm('رفض كل الاقتراحات الموجودة في قائمة المراجعة؟'))return;state.reviewQueue=[];await persist();renderAIQueue();toast('تم رفض كل الاقتراحات.');return;}
    const nav=e.target.closest('.nav-item');if(nav){navigate(nav.dataset.view);return;}
    const go=e.target.closest('[data-go]');if(go){navigate(go.dataset.go);return;}
    if(e.target.closest('#quick-add')||e.target.closest('#add-product-btn')){openProductModal();return;}
    const cam=e.target.closest('[data-camera-for]');if(cam){const p=state.products.find(x=>x.id===cam.dataset.cameraFor);if(p)openProductModal(p,null,true);return;}
    if(e.target.closest('#add-invoice-btn')){if(!state.products.length){toast('أضف منتجاً واحداً على الأقل قبل إنشاء الفاتورة.');return;}openInvoiceModal();return;}
    if(e.target.closest('#add-slide-btn')){openSlideModal();return;}
    const cat=e.target.closest('[data-category]');if(cat){activeCategory=cat.dataset.category;renderProducts();return;}
    const ep=e.target.closest('[data-edit-product]');if(ep){openProductModal(state.products.find(p=>p.id===ep.dataset.editProduct));return;}
    const dp=e.target.closest('[data-delete-product]');if(dp){const p=state.products.find(x=>x.id===dp.dataset.deleteProduct);if(p&&confirm(`هل تريد حذف المنتج «${p.name}»؟`)){state.products=state.products.filter(x=>x.id!==p.id);state.slides=state.slides.filter(x=>x.productId!==p.id);await persist();renderAll();toast('تم حذف المنتج.');}return;}
    const ti=e.target.closest('[data-toggle-invoice]');if(ti&&!e.target.closest('button')){ti.closest('.invoice-card').classList.toggle('open');return;}
    const pi=e.target.closest('[data-print-invoice]');if(pi){const inv=state.invoices.find(x=>x.id===pi.dataset.printInvoice);if(inv)printInvoice(inv);return;}
    const si=e.target.closest('[data-share-invoice]');if(si){const inv=state.invoices.find(x=>x.id===si.dataset.shareInvoice);if(inv)await shareInvoice(inv);return;}
    const di=e.target.closest('[data-delete-invoice]');if(di){await deleteInvoice(di.dataset.deleteInvoice);return;}
    const es=e.target.closest('[data-edit-slide]');if(es){openSlideModal(state.slides.find(x=>x.id===es.dataset.editSlide));return;}
    const ds=e.target.closest('[data-delete-slide]');if(ds){if(confirm('حذف هذه الشريحة؟')){state.slides=state.slides.filter(x=>x.id!==ds.dataset.deleteSlide);state.slides.forEach((s,i)=>s.order=i);await persist();renderSlides();toast('تم حذف الشريحة.');}return;}
    const cd=e.target.closest('[data-carousel-dir]'); if(cd){const root=$('#slider-preview'); const count=state.slides.length; if(count){root.dataset.index=(Number(root.dataset.index)||0)+Number(cd.dataset.carouselDir); if(Number(root.dataset.index)<0)root.dataset.index=count-1; if(Number(root.dataset.index)>=count)root.dataset.index=0; renderCarousel();} return;}
    const ms=e.target.closest('[data-move-slide]');if(ms){const idx=state.slides.findIndex(x=>x.id===ms.dataset.moveSlide);const dir=ms.dataset.dir==='up'?-1:1;const next=idx+dir;if(idx>=0&&next>=0&&next<state.slides.length){[state.slides[idx],state.slides[next]]=[state.slides[next],state.slides[idx]];state.slides.forEach((s,i)=>s.order=i);await persist();renderSlides();}return;}
    const dc=e.target.closest('[data-delete-company]');if(dc){const c=state.companies.find(x=>x.id===dc.dataset.deleteCompany);if(c&&confirm(`هل تريد حذف الشركة «${c.name}»؟`)){state.companies=state.companies.filter(x=>x.id!==c.id);await persist();renderCompanies();toast('تم حذف الشركة.');}return;}
    const rc=e.target.closest('[data-remove-contact]');if(rc){state.contacts.splice(Number(rc.dataset.removeContact),1);renderSettings();return;}
    const rg=e.target.closest('[data-remove-group]');if(rg){state.groups.splice(Number(rg.dataset.removeGroup),1);renderSettings();return;}
  });


  $('#home-refresh-exchange').onclick=()=>{refreshExchangeRate(false);const f=$('#lyra-iframe');f.src=f.src;};
  $('#add-company-btn').onclick=()=>openCompanyModal();
  $('#ai-suggest-product').onclick=()=>createReviewSuggestions('product');
  $('#ai-suggest-slider').onclick=()=>createReviewSuggestions('slider');
  $('#save-gemini-key').onclick=async()=>{const key=$('#gemini-key').value.trim();if(!key){toast('الصق مفتاح Gemini أولاً.');return;} const b=$('#save-gemini-key');b.disabled=true;b.textContent='⏳ حفظ آمن…';const r=await window.taysirAPI?.saveGeminiKey?.({apiKey:key});b.disabled=false;b.textContent='🔐 حفظ المفتاح';if(r?.ok){state.geminiConfigured=true;await persist();$('#gemini-key').value='';if($('#gemini-status'))$('#gemini-status').textContent='✓ Gemini محفوظ بشكل آمن على هذا الجهاز';toast('تم حفظ مفتاح Gemini بشكل مشفّر وآمن ✓');}else toast(r?.error||'تعذر حفظ مفتاح Gemini.');};
  $('#test-gemini-key').onclick=async()=>{const b=$('#test-gemini-key');b.disabled=true;b.textContent='⏳ اختبار…';const typed=$('#gemini-key').value.trim();const r=await window.taysirAPI?.testGemini?.(typed?{apiKey:typed}:{});b.disabled=false;b.textContent='✓ اختبار الاتصال';if(r?.ok){if(typed){const save=await window.taysirAPI.saveGeminiKey({apiKey:typed});if(save?.ok){state.geminiConfigured=true;await persist();$('#gemini-key').value='';}} toast('تم الاتصال بـ Gemini بنجاح ✓');if($('#gemini-status'))$('#gemini-status').textContent='✓ الاتصال يعمل';}else toast(r?.error||'فشل الاتصال بـ Gemini.');};
  $('#import-pdf-btn').onclick=()=>$('#pdf-file-input').click();
  // ===== OCR / استيراد نشرة الأسعار — v2.0 robust =====
  let ocrWorker=null, pdfCancelled=false, pdfRunToken=0;
  function setStatus(t){ let el=$('#ocr-status'); if(!el){el=document.createElement('div');el.id='ocr-status';el.className='toast pdf-status-toast';$('#toast-root').appendChild(el);} el.textContent=t; }
  function clearStatus(){ $('#ocr-status')?.remove(); }
  function normalizePdfText(s){return String(s||'').normalize('NFKC').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/\u200e|\u200f|[\u202a-\u202e]/g,'').replace(/[ـ]/g,'').replace(/\s+/g,' ').trim();}
  function pdfTextLines(items,scale){
    const its=items.filter(i=>i.str&&i.str.trim()).map(i=>({s:i.str,x:i.transform[4]*scale,y:i.transform[5]*scale,w:(i.width||0)*scale,h:Math.abs(i.height||i.transform[3]||10)*scale}));
    its.sort((a,b)=>b.y-a.y||a.x-b.x); const groups=[];
    for(const it of its){let g=groups.find(x=>Math.abs(x.y-it.y)<=Math.max(3,it.h*.45));if(!g){g={y:it.y,items:[]};groups.push(g);}g.items.push(it);}
    return groups.sort((a,b)=>b.y-a.y).map(g=>{const rtl=g.items.filter(i=>/[\u0600-\u06FF]/.test(i.s)).length>g.items.length/2;const arr=g.items.sort((a,b)=>rtl?b.x-a.x:a.x-b.x);let text='';for(let k=0;k<arr.length;k++){if(k){const prev=arr[k-1];const gap=rtl?prev.x-(arr[k].x+arr[k].w):arr[k].x-(prev.x+prev.w);text+=gap>arr[k].h*1.8?'\t':' ';}text+=arr[k].s;}return {text:normalizePdfText(text),top:Math.max(0,g.y-Math.max(...g.items.map(i=>i.h))),bottom:g.y+Math.max(...g.items.map(i=>i.h)),items:arr};}).filter(x=>x.text);
  }
const VOCAB=new Set("بخاخة ماء ملونة محجرة مدورة سعة بطة هرم ليتر لتر مل جرن حمام بلاستيك حمالة صابون وجه كريستال ماسة مع غطاء بدون زاوية رفوف تركيب حديثة مجلى مثلثة موديل شبح سطل بيضوي بشفة قياس وسط دعسة صغير صغيرة قمامة لواح كبير كبيرة جامبو سلة غسيل مربعة طويلة مزخرفة مستطيلة مستطيل قصيرة علبة محارم سائل حوضين مضخة فراشي اسنان طقم ثاني ثانوي نزهة قتالة ذبان كرسي كريك حديد ملون حراري لمامة فرشاة واحدة ثنائية ثلاثية رباعية سداسية متحركة مساحة مصفاية كرت قطع مكنسة نفخ قشارة بطاطا نانا ملقط نوع أول اول راصور بصلبة حوض زريعة درج ثلاثي كوخ اطفال أطفال رباعي ملابس خامسي عليقة ولادي عروس لون بيج مبروم عادي رجالي خشب اوكورديون طاولة مراية ملكية ثوم حصيرة نحاس نورا فارغ سياخ شوبك قطعة مضلفة سلفان طابع خبز نمرة عصارة حمضيات ابريق جاط فواكه حافظة شفافة شفاف مونة سيران مطربان بهارات علبة مطرة لانش بوكس سندوتش سندويش ميكانو سيارة بانيو مستحمة نقاصة بيديه قرميد صحن صحون صينية طشت طشط قمع كاسة كاسات قالب ثلج مصفاية مكيال مملحة منخل كبة مبشرة بيتفور سمبوسة فلافل معمول زبدية سكرية متة دبدوب جلد صواني طقم زيزا".split(" "));
  function lev(a,b){const m=a.length,n=b.length,d=Array.from({length:m+1},(_,i)=>[i]);for(let j=1;j<=n;j++)d[0][j]=j;for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return d[m][n];}
  function fixNameWords(name){let changed=false;const out=String(name).split(/(\s+|\/|\\|-)/).map(t=>{if(!/^[\u0600-\u06FF]{4,}$/.test(t)||VOCAB.has(t))return t;let best=null,bd=9,tie=false;for(const w of VOCAB){if(Math.abs(w.length-t.length)>1)continue;const d=lev(t,w);if(d<bd){bd=d;best=w;tie=false;}else if(d===bd)tie=true;}if(best&&bd===1&&!tie){changed=true;return best;}return t;});return{name:out.join(''),changed};}
  function cleanOcrText(s){return normalizePdfText(s).replace(/[|¦_=~]+/g,' ').replace(/\s+/g,' ').trim();}
  function parseProductLine(text){
    let line=cleanOcrText(text); if(!line) return null;
    const nums=[...line.matchAll(/\b\d{1,8}(?:[.,]\d{1,3})?\b/g)].map(m=>({raw:m[0],i:m.index,n:Number(m[0].replace(',','.'))}));
    const codeHit=nums.filter(x=>/^\d{4,8}$/.test(x.raw)).sort((a,b)=>b.raw.length-a.raw.length)[0];
    if(!codeHit) return null;
    const after=nums.filter(x=>x!==codeHit&&x.n>0&&x.n<100000); if(!after.length)return null;
    const price=after.find(x=>/[.,]\d{1,3}$/.test(x.raw))||after[after.length-1];
    let name=line.replace(codeHit.raw,' ').replace(price.raw,' ').replace(/\b(?:USD|US\$|SYP|دولار(?:اً|ا)?|ل\.?\s?س|ليرة(?:\s?سورية)?)\b/ig,' ').replace(/[|:=]+/g,' ').replace(/\s+/g,' ').trim();
    name=name.replace(/^[\-–—./]+|[\-–—./]+$/g,'').trim(); const letters=(name.match(/[A-Za-z\u0600-\u06FF]/g)||[]).length;
    if(letters<3||name.length<3)return null; const fx=fixNameWords(name);return {name:fx.name,code:codeHit.raw,priceUsd:price.n,priceSyp:0,uncertain:name.length<5||price.n<=0||fx.changed,note:fx.changed?'تم اكتشاف تصحيح إملائي محتمل — راجع الاسم والكود والسعر':''};
  }
  function findCodeBox(line){for(const it of(line.items||[]))if(/\d{4,8}/.test(it.s))return{x0:it.x,x1:it.x+it.w};return null;}
  const gridCache=new WeakMap();
  function groupRuns(arr){const g=[];let s=null,p=null;for(const v of arr){if(s===null){s=p=v;}else if(v-p<=3){p=v;}else{g.push(Math.round((s+p)/2));s=p=v;}}if(s!==null)g.push(Math.round((s+p)/2));return g;}
  function tableGrid(cv){
    if(gridCache.has(cv))return gridCache.get(cv);let out=null;
    try{
      const W=cv.width,H=cv.height,d=cv.getContext('2d',{willReadFrequently:true}).getImageData(0,0,W,H).data,wh=(x,y)=>{const i=(y*W+x)*4;return d[i]>228&&d[i+1]>228&&d[i+2]>228;};
      const xa=Math.floor(W*.04),xb=Math.floor(W*.96),ys=[];
      for(let y=0;y<H;y++){let c=0,n=0;for(let x=xa;x<xb;x+=3){n++;if(wh(x,y))c++;}if(c/n>.86)ys.push(y);}
      const lines=groupRuns(ys),bands=[];
      for(let i=0;i<lines.length-1;i++){const h=lines[i+1]-lines[i];if(h>H*.02&&h<H*.2)bands.push({y0:lines[i]+3,y1:lines[i+1]-3});}
      if(bands.length>=3){
        const med=bands.map(b=>b.y1-b.y0).sort((p,q)=>p-q)[Math.floor(bands.length/2)],ok=bands.filter(b=>Math.abs((b.y1-b.y0)-med)<=med*.35);
        const top=Math.round(ok[0].y0),bot=Math.round(ok[ok.length-1].y1),xs=[];
        for(let x=Math.floor(W*.5);x<W;x++){let c=0,n=0;for(let y=top;y<bot;y+=3){n++;if(wh(x,y))c++;}if(c/n>.8)xs.push(x);}
        const vc=groupRuns(xs),inner=vc.filter(x=>x<W*.965),outer=vc.filter(x=>x>=W*.965);
        out={bands:ok,x0:inner.length?Math.max(...inner)+3:Math.floor(W*.88),x1:outer.length?Math.min(...outer)-3:W-4};
      }
    }catch(e){out=null;}
    gridCache.set(cv,out);return out;
  }
  function cropBand(cv,b,g,full){const W=cv.width,x0=full?Math.floor(W*.01):g.x0,x1=full?Math.floor(W*.99):g.x1,y0=Math.floor(b.y0),y1=Math.ceil(b.y1);if(x1-x0<20||y1-y0<12)return '';const c=document.createElement('canvas');c.width=x1-x0;c.height=y1-y0;c.getContext('2d').drawImage(cv,x0,y0,c.width,c.height,0,0,c.width,c.height);return compressCanvas(c,full?900:520,.9);}
  // قصّ صورة المنتج من خانة سطره فقط (حدود الجدول الفعلية من البكسلات)، وإلا لا صورة بدل صورة خاطئة
  function cropRowProduct(cv,row){const g=tableGrid(cv);if(!g)return '';let c=(row.top+row.bottom)/2;if(row.source==='text')c=cv.height-c;const b=g.bands.find(b=>c>=b.y0-4&&c<=b.y1+4);if(!b)return '';row.rowImage=cropBand(cv,b,g,true);return cropBand(cv,b,g,false);}
  function compressCanvas(c,max=1200,q=.82){const scale=Math.min(1,max/c.width),out=document.createElement('canvas');out.width=Math.max(1,Math.round(c.width*scale));out.height=Math.max(1,Math.round(c.height*scale));out.getContext('2d').drawImage(c,0,0,out.width,out.height);return out.toDataURL('image/jpeg',q);}
  function preprocessCanvas(src){const c=document.createElement('canvas');c.width=src.width;c.height=src.height;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(src,0,0);const d=x.getImageData(0,0,c.width,c.height),a=d.data;for(let i=0;i<a.length;i+=4){const g=.299*a[i]+.587*a[i+1]+.114*a[i+2],v=g>170?255:g<70?0:(g-70)*255/100;a[i]=a[i+1]=a[i+2]=v;}x.putImageData(d,0,0);return c;}
  async function getOCRWorker(langs='ara+eng',psm='4'){if(ocrWorker)return ocrWorker;ocrWorker=await Tesseract.createWorker(langs,1,{logger:m=>{if(m.status==='recognizing text')setStatus(`جارٍ قراءة الصفحة — OCR ${Math.round((m.progress||0)*100)}%`);}});await ocrWorker.setParameters({preserve_interword_spaces:'1',tessedit_pageseg_mode:String(psm||'4')});return ocrWorker;}
  async function renderPdfPage(page,scale){const vp=page.getViewport({scale}),c=document.createElement('canvas');c.width=Math.ceil(vp.width);c.height=Math.ceil(vp.height);const ctx=c.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);await page.render({canvasContext:ctx,viewport:vp}).promise;return c;}
  function progressModal(total){
    $('#modal-root').innerHTML=`<div class="modal-backdrop pdf-progress-backdrop"><div class="modal glass-modal pdf-progress-modal"><div class="progress-head"><div><span class="section-kicker">استيراد ذكي</span><h2>جارٍ قراءة النشرة</h2></div><span id="pdf-page-count">0 / ${total}</span></div><div class="ocr-progress"><div class="bar"><i id="ocr-bar"></i></div><div class="ocr-status" id="ocr-status">تجهيز الملف…</div></div><div class="pdf-progress-log" id="pdf-progress-log"></div><div class="modal-actions"><button type="button" class="secondary-btn danger-text" id="ocr-cancel">إلغاء الاستيراد</button></div></div></div>`;
    const token=++pdfRunToken;$('#ocr-cancel').onclick=()=>{pdfCancelled=true;$('#ocr-cancel').disabled=true;$('#ocr-cancel').textContent='جارٍ الإلغاء…';$('#ocr-status').textContent='جارٍ إيقاف العملية بأمان…';if(ocrWorker){try{ocrWorker.terminate();}catch(_){}ocrWorker=null;}};
    return(page,pct,msg)=>{if(token!==pdfRunToken)return;const overall=((page-1)+pct)/total*100;$('#ocr-bar').style.width=Math.round(overall)+'%';$('#pdf-page-count').textContent=`${page} / ${total}`;$('#ocr-status').textContent=`الصفحة ${page} من ${total} — ${msg}`;};
  }
  function addProgressLog(text){const el=$('#pdf-progress-log');if(!el)return;const p=document.createElement('div');p.textContent=text;el.prepend(p);while(el.children.length>4)el.lastChild.remove();}
  async function readPdf(file,opts={}){
    pdfCancelled=false;const pdf=await pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer()),disableAutoFetch:false,disableStream:false}).promise,total=pdf.numPages,progress=progressModal(total),rows=[];let worker=null;
    try{for(let n=1;n<=total;n++){if(pdfCancelled)throw new Error('cancelled');let page,lastErr=null,success=false;for(let attempt=1;attempt<=2&&!success;attempt++){try{progress(n,0,attempt===1?'تحليل الصفحة':'إعادة محاولة الصفحة');page=await pdf.getPage(n);const baseVp=page.getViewport({scale:1}),textContent=await page.getTextContent(),scale=Math.max(1.5,Math.min(2.2,2200/baseVp.width)),lines=pdfTextLines(textContent.items,scale),joined=lines.map(x=>x.text).join(' '),textLooksUseful=joined.replace(/\s/g,'').length>=25&&/[A-Za-z\u0600-\u06FF]/.test(joined);let canvas;
        if(opts.useGemini&&window.taysirAPI?.geminiReadPage&&(!textLooksUseful||opts.forceOcr)){progress(n,.15,'قراءة الصفحة بـ Gemini (قراءة أولى)');canvas=await renderPdfPage(page,Math.max(1.6,Math.min(2.4,2000/baseVp.width)));const img64=compressCanvas(canvas,1800,.92).split(',')[1];const r1=await window.taysirAPI.geminiReadPage({image:img64});if(!r1?.ok)throw new Error(r1?.error||'فشلت قراءة Gemini');if(pdfCancelled)throw new Error('cancelled');progress(n,.55,'قراءة ثانية للتدقيق');const r2=await window.taysirAPI.geminiReadPage({image:img64,second:true});const W=canvas.width,H=canvas.height,digits=v=>String(v??'').replace(/\D/g,''),num=v=>Number(String(v??'').replace(',','.')),crop=(b,pad)=>{if(!Array.isArray(b)||b.length<4)return '';const[y0,x0,y1,x1]=b.map(Number);if([y0,x0,y1,x1].some(v=>!isFinite(v)))return '';const X0=Math.max(0,Math.floor(x0/1000*W)-pad),Y0=Math.max(0,Math.floor(y0/1000*H)-pad),X1=Math.min(W,Math.ceil(x1/1000*W)+pad),Y1=Math.min(H,Math.ceil(y1/1000*H)+pad);if(X1-X0<20||Y1-Y0<12)return '';const c=document.createElement('canvas');c.width=X1-X0;c.height=Y1-Y0;c.getContext('2d').drawImage(canvas,X0,Y0,c.width,c.height,0,0,c.width,c.height);return compressCanvas(c,760,.9);},second=new Map((r2?.ok?r2.data.rows:[]).map(x=>[digits(x.code),x])),seen=new Set(rows.map(x=>x.code)),g=(r1.data.rows||[]).map(x=>{const code=digits(x.code),price=num(x.price),rawName=cleanOcrText(x.name||''),fx=fixNameWords(rawName),name=fx.name,y=second.get(code),why=[];if(fx.changed)why.push('تصحيح إملائي تلقائي — دقّق');if(!/^\d{4,8}$/.test(code))why.push('كود غير واضح');if(!(price>0))why.push('سعر صفر/غير واضح');if(name.length<3)why.push('اسم قصير');if(!y)why.push('لم يتطابق مع القراءة الثانية');else{if(cleanOcrText(y.name||'')!==rawName)why.push('الاسم يختلف بين القراءتين');if(num(y.price)!==price)why.push('السعر يختلف بين القراءتين');}if(seen.has(code))why.push('كود مكرر');seen.add(code);return{name,code,priceUsd:isFinite(price)?price:0,priceSyp:0,page:n,conf:why.length?60:100,raw:name,source:'gemini',_ib:x.image_box,_rb:x.row_box,rowImage:crop(x.row_box,0),uncertain:why.length>0,note:why.join('، ')};}).filter(x=>x.name&&x.code);const cy=r=>Array.isArray(r._rb)&&r._rb.length>=4&&r._rb.every(v=>isFinite(Number(v)))?(Number(r._rb[0])+Number(r._rb[2]))/2:null,srt=g.filter(r=>cy(r)!==null).sort((p,q)=>cy(p)-cy(q)),ibs=g.map(r=>r._ib).filter(b=>Array.isArray(b)&&b.length>=4&&b.every(v=>isFinite(Number(v)))).map(b=>b.map(Number)),med=k=>{const v=ibs.map(b=>b[k]).sort((p,q)=>p-q);return v.length?v[Math.floor(v.length/2)]:null;},ix0=med(1)??850,ix1=med(3)??985;srt.forEach((r,i)=>{const c=cy(r),pc=i>0?cy(srt[i-1]):null,nc=i<srt.length-1?cy(srt[i+1]):null,own=(Number(r._rb[2])-Number(r._rb[0]))/2,hh=Math.min(own,...[pc!==null?(c-pc)/2:null,nc!==null?(nc-c)/2:null].filter(v=>v!==null&&v>3));r.sourceImage=crop([c-hh*.92,ix0,c+hh*.92,ix1],0);});const gr=tableGrid(canvas);if(gr)for(const r of g){const cc=cy(r);if(cc===null)continue;const yy=cc/1000*H,bb=gr.bands.find(b=>yy>=b.y0-4&&yy<=b.y1+4);if(bb){r.sourceImage=cropBand(canvas,bb,gr,false);r.rowImage=cropBand(canvas,bb,gr,true);}}g.forEach(r=>{delete r._rb;delete r._ib;});rows.push(...g);addProgressLog(`✓ الصفحة ${n}: ${g.length} منتج (Gemini، ${g.filter(x=>x.uncertain).length} للمراجعة)`);progress(n,1,`Gemini اكتمل — ${g.length} منتج`);success=true;}else if(textLooksUseful){progress(n,.45,'النص الأصلي موجود — بدون OCR');canvas=await renderPdfPage(page,scale);const candidates=lines.map(l=>{const p=parseProductLine(l.text);return p?{...p,page:n,conf:100,raw:l.text,top:l.top,bottom:l.bottom,source:'text',textLine:l}:null;}).filter(Boolean),usable=candidates.filter(r=>r.name&&r.code&&r.priceUsd>0);for(const r of usable)r.sourceImage=cropRowProduct(canvas,r,usable.map(x=>x.textLine));rows.push(...usable.map(({textLine,...r})=>r));addProgressLog(`✓ الصفحة ${n}: ${usable.length} منتج من النص`);progress(n,1,`تم العثور على ${usable.length} منتج`);success=true;
        }else{progress(n,.18,'الصفحة مصوّرة — تشغيل OCR');canvas=await renderPdfPage(page,Math.max(1.7,Math.min(2.8,2300/baseVp.width)));if(pdfCancelled)throw new Error('cancelled');worker=worker||await getOCRWorker(opts.langs||'ara+eng',opts.psm||'4');const data=await worker.recognize(preprocessCanvas(canvas));if(pdfCancelled)throw new Error('cancelled');const lines=(data.data?.lines||data.lines||[]).map(l=>({text:cleanOcrText(l.text||''),top:l.bbox?.y0??0,bottom:l.bbox?.y1??0,conf:l.confidence??0,items:l.words||[]})).filter(x=>x.text),candidates=lines.map(l=>{const p=parseProductLine(l.text);return p?{...p,page:n,conf:Math.round(l.conf),raw:l.text,top:l.top,bottom:l.bottom,source:'ocr',textLine:l}:null;}).filter(Boolean),usable=candidates.filter(r=>r.name&&r.code&&r.priceUsd>0);for(const r of usable)r.sourceImage=cropRowProduct(canvas,r,usable.map(x=>x.textLine));rows.push(...usable.map(({textLine,...r})=>({...r,uncertain:r.uncertain||r.conf<72,note:r.note||(r.conf<72?'ثقة OCR منخفضة — راجع النتيجة':'')})));addProgressLog(`✓ الصفحة ${n}: ${usable.length} منتج عبر OCR`);progress(n,1,`OCR اكتمل — ${usable.length} منتج`);success=true;}
        if(canvas){canvas.width=1;canvas.height=1;}}
        catch(e){lastErr=e;if(pdfCancelled||e?.message==='cancelled')throw new Error('cancelled');if(attempt===2){addProgressLog(`⚠ الصفحة ${n}: تعذر القراءة وتم تجاوزها`);progress(n,1,'تعذر قراءة الصفحة — تم تجاوزها');}}}if(lastErr&&!success)console.warn('PDF page failed',n,lastErr);await new Promise(r=>setTimeout(r,0));}
      if(pdfCancelled)throw new Error('cancelled');if(!rows.length)throw new Error('لم أجد منتجات واضحة في النشرة. جرّب إعادة الاستيراد أو جودة ملف أوضح.');progress(total,1,`اكتملت القراءة — ${rows.length} منتج`);return rows;
    }finally{if(worker){try{await worker.terminate();}catch(_){}}try{await pdf.cleanup();}catch(_){} }
  }
  function pdfRowsReview(file,rows){
    const existingNames=new Set(state.products.map(p=>normalizePdfText(p.name).toLowerCase())),existingCodes=new Set(state.products.map(p=>normalizePdfText(p.code).toLowerCase()).filter(Boolean));rows.forEach(r=>{r.duplicate=existingNames.has(normalizePdfText(r.name).toLowerCase())||(r.code&&existingCodes.has(normalizePdfText(r.code).toLowerCase()));if(r.duplicate)r.selected=false;else if(r.selected===undefined)r.selected=!r.uncertain;});
    const html=rows.map((r,i)=>`<tr data-r="${i}" class="${r.uncertain?'ocr-warn':''} ${r.duplicate?'dup':''}"><td><input type="checkbox" name="ok" ${r.selected?'checked':''}></td><td>${r.page}</td><td>${r.sourceImage?`<img class="ocr-product-page product-crop" src="${r.sourceImage}" alt="صورة المنتج">`:'—'}</td><td>${r.rowImage?`<img class="ocr-row-img" src="${r.rowImage}" alt="الصف الأصلي">`:'—'}</td><td><input name="name" value="${esc(r.name)}"></td><td><input name="code" value="${esc(r.code)}" dir="ltr"></td><td><input name="usd" type="number" step="0.01" min="0" value="${r.priceUsd||''}" dir="ltr"></td><td>${r.duplicate?'<span class="ocr-badge dup">موجود مسبقاً</span>':r.uncertain?`<span class="ocr-badge" title="${esc(r.note||'')}">راجع ${r.note?esc(r.note):(r.conf||'')+'%'}</span>`:'<span class="ocr-badge ok">✓</span>'}</td><td><button type="button" class="small-btn" data-ocr-review="${i}">مراجعة</button></td></tr>`).join('');
    modal({title:'مراجعة نشرة الأسعار',subtitle:`تم استخراج ${rows.length} منتج. الصور المعروضة هي قصاصات من خانة صورة المنتج، وليس صفحات كاملة. راجع الأسماء المعلّمة قبل الاعتماد.`,submitText:'اعتماد المحدد وإضافة المنتجات',body:`<div class="ocr-select-actions"><button type="button" class="secondary-btn" id="pdf-select-all">☑ تحديد الكل</button><button type="button" class="secondary-btn" id="pdf-select-none">☐ إلغاء تحديد الكل</button></div><div class="ocr-summary" id="pdf-summary"></div><div class="ocr-results"><table class="invoice-table ocr-table"><thead><tr><th><input type="checkbox" id="pdf-all"></th><th>ص</th><th>صورة المنتج</th><th>الصف الأصلي</th><th>الاسم</th><th>الكود</th><th>السعر $</th><th>الحالة</th><th>التدقيق</th></tr></thead><tbody id="pdf-review-body">${html}</tbody></table></div>`,onSubmit:async form=>{const selected=[];$$('#pdf-review-body tr',form).forEach(row=>{if(!$('[name=ok]',row).checked)return;const r=rows[Number(row.dataset.r)];r.name=$('[name=name]',row).value.trim();r.code=$('[name=code]',row).value.trim();r.priceUsd=Number($('[name=usd]',row).value)||0;if(r.name&&r.priceUsd>0)selected.push(r);});if(!selected.length)throw new Error('حدّد منتجاً صالحاً واحداً على الأقل.');const company=await new Promise(resolve=>modal({title:'تحديد الشركة أو العلامة التجارية',subtitle:`تم تحليل ${selected.length} منتج. حدّد الشركة أو العلامة التجارية التي تتبع لها هذه المنتجات.`,submitText:'متابعة',body:`<label>الشركة أو العلامة التجارية<input name="company" list="co-list" placeholder="مثال: اسم الشركة" required><datalist id="co-list">${state.companies.map(c=>`<option value="${esc(c.name)}">`).join('')}</datalist></label>`,onSubmit:async f=>{const v=String(new FormData(f).get('company')).trim();if(!v)throw new Error('اكتب اسم الشركة أو العلامة التجارية.');closeModal();resolve(v);}}));const now=Date.now(),added=selected.map((r,i)=>({id:uid('prod'),name:r.name,code:r.code||'',category:company,company,priceUsd:r.priceUsd,priceSyp:state.exchangeRate?Math.round(r.priceUsd*state.exchangeRate):0,description:'',image:r.sourceImage||'',sourceImage:r.sourceImage||'',sourceFile:file.name,sourcePage:r.page,sourceConfidence:r.conf||100,createdAt:now+i,updatedAt:now+i}));state.products.push(...added);if(!state.companies.some(c=>c.name===company))state.companies.push({id:uid('company'),name:company,info:'',logo:''});await persist();closeModal();renderAll();toast(`تمت إضافة ${added.length} منتج ✓`);}});
    $('.modal')?.classList.add('wide');
    $$('#pdf-review-body [data-ocr-review]').forEach(btn=>btn.onclick=()=>{
      const r=rows[Number(btn.dataset.ocrReview)]; if(!r)return;
      modal({title:'مراجعة نتيجة OCR',subtitle:`الصفحة ${r.page||'—'} — تأكد من الاسم والكود والسعر قبل الاعتماد.`,submitText:'حفظ التصحيح',body:`<div class="ocr-focus-review">${r.rowImage?`<img src="${r.rowImage}" alt="الصف الأصلي" class="ocr-review-image">`:''}<div class="form-grid"><label>اسم المنتج<input name="name" value="${esc(r.name||'')}"></label><label>الكود<input name="code" value="${esc(r.code||'')}" inputmode="numeric" dir="ltr"></label><label>السعر بالدولار<input name="usd" type="number" step="0.01" min="0" value="${r.priceUsd||''}" inputmode="decimal" dir="ltr"></label></div><p class="muted">ملاحظة OCR: ${esc(r.note||'النتيجة تبدو مستقرة')}</p></div>`,onSubmit:async f=>{const d=new FormData(f),name=String(d.get('name')||'').trim(),code=String(d.get('code')||'').trim(),price=Number(d.get('usd'))||0;if(!name||!code||price<=0)throw new Error('تأكد من الاسم والكود والسعر.');r.name=name;r.code=code;r.priceUsd=price;r.uncertain=false;r.note='تمت مراجعته يدوياً';r.conf=100;closeModal();pdfRowsReview(file,rows);}});
    });
    const sync=()=>{const c=$$('#pdf-review-body input[name=ok]').filter(x=>x.checked).length;$('#pdf-summary').textContent=`${rows.length} مقروء — ${c} محدد للإضافة`;$('#pdf-all').checked=c===rows.length;};$('#pdf-all').onchange=e=>{$$('#pdf-review-body input[name=ok]').forEach(x=>x.checked=e.target.checked);sync();};$('#pdf-select-all').onclick=()=>{$$('#pdf-review-body input[name=ok]').forEach(x=>x.checked=true);sync();};$('#pdf-select-none').onclick=()=>{$$('#pdf-review-body input[name=ok]').forEach(x=>x.checked=false);sync();};$('#pdf-review-body').addEventListener('change',sync);sync();
  }
  async function importPriceList(file,opts={}){if(!file)throw new Error('اختر ملفاً أولاً.');if(file.type==='application/pdf'&&!window.pdfjsLib)throw new Error('محرك PDF غير محمّل.');if(!window.Tesseract)throw new Error('محرك OCR غير محمّل.');try{const rows=file.type==='application/pdf'?await readPdf(file,opts):[];clearStatus();pdfRowsReview(file,rows);}catch(err){clearStatus();if(err.message==='cancelled'){closeModal();toast('تم إلغاء استيراد النشرة بدون فقدان البيانات.');}else{closeModal();toast('فشل استيراد النشرة: '+(err.message||err));}throw err;}}
  function openPdfOptions(file){modal({title:'استيراد نشرة أسعار',subtitle:`الملف: ${file.name}`,submitText:'بدء القراءة',body:`<div class=\"form-grid\"><label>عملة الأسعار<select name=\"currency\"><option value=\"USD\">دولار ($)</option><option value=\"SYP\">ليرة سورية</option></select></label><label>لغة OCR<select name=\"langs\"><option value=\"ara+eng\">عربي + إنجليزي</option><option value=\"ara\">عربي فقط</option><option value=\"eng\">إنجليزي فقط</option></select></label><label>تخطيط OCR<select name=\"psm\"><option value=\"4\">جدول / أعمدة</option><option value=\"6\">كتلة نصية</option><option value=\"3\">تلقائي</option></select></label><label class=\"chk full-row\"><input type=\"checkbox\" name=\"forceOcr\"> فرض OCR على كل الصفحات</label><label class=\"chk full-row\"><input type=\"checkbox\" name=\"gem\" ${state.geminiConfigured?'checked':''}> قراءة الصفحات المصوّرة بـ Gemini مرتين وتدقيقها (الأدق — يحتاج مفتاحاً محفوظاً)</label><div class=\"muted full-row\">الصفحات التي تحتوي نصاً حقيقياً ستُقرأ مباشرة. الصفحات المصوّرة فقط تستخدم OCR، والصور تُقص من خانة المنتج.</div></div>`,onSubmit:async form=>{const d=new FormData(form);closeModal();await importPriceList(file,{currency:d.get('currency'),langs:d.get('langs'),psm:d.get('psm'),forceOcr:d.get('forceOcr')==='on',useGemini:d.get('gem')==='on'});}});}
  $('#import-pdf-btn').onclick=()=>$('#pdf-file-input').click();
  $('#pdf-file-input').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{openPdfOptions(f);}catch(_){ }finally{e.target.value='';}};

  $('#product-search').addEventListener('input',renderProducts);
  $('#settings-form').addEventListener('submit',async e=>{e.preventDefault();const mn=String($('#setting-manager-name')?.value||'').trim();if(mn.length<2){toast('اسم المدير مطلوب.');return;}state.managerName=mn;state.exchangeRate=Number($('#setting-exchange').value)||0;state.direction=$('#setting-direction').value;state.exchangeManual=true;
    state.business=Object.assign({},state.business,{address:$('#setting-address').value.trim(),ordersOpen:$('#setting-orders-open').value||'09:00',ordersClose:$('#setting-orders-close').value||'18:00'});
    for(const [id,key] of [['sham-cash','shamCashBarcode'],['channel','channelBarcode']]){const f=$(`#setting-${id}-barcode`)?.files?.[0]; if(f) state.business[key]=await fileToDataUrl(f);}
    await persist();renderStats();renderDashboard();toast('تم حفظ إعدادات المركز.');});
  $('#undo-delete').addEventListener('change',async e=>{state.undoDelete=e.target.checked;await persist();});
  $('#refresh-exchange').addEventListener('click',()=>refreshExchangeRate(false));
  $('#add-contact').onclick=()=>{state.contacts.push({name:'',phone:''});renderSettings();};
  $('#add-group').onclick=()=>{state.groups.push({name:'',url:''});renderSettings();};
  $('#save-links').onclick=async()=>{state.contacts=state.contacts.map((c,i)=>({name:$(`[data-contact-name="${i}"]`)?.value.trim()||'',phone:$(`[data-contact-phone="${i}"]`)?.value.trim()||''})).filter(x=>x.name||x.phone);state.groups=state.groups.map((g,i)=>({name:$(`[data-group-name="${i}"]`)?.value.trim()||'',url:$(`[data-group-url="${i}"]`)?.value.trim()||''})).filter(x=>x.name||x.url);await persist();renderSettings();toast('تم حفظ أرقام التواصل وروابط المجموعات.');};

  document.addEventListener('change',async e=>{
    const s=e.target.closest('[data-sel]'); if(s){ s.checked?selIds.add(s.dataset.sel):selIds.delete(s.dataset.sel); updateBulk(); return; }
    const im=e.target.closest('[data-img-for]'); if(im&&im.files[0]){ try{ const u=await fileToDataUrl(im.files[0]); const p=state.products.find(x=>x.id===im.dataset.imgFor); if(p){p.image=u;p.updatedAt=Date.now();await persist();renderAll();toast('تمت إضافة الصورة.');} }catch(err){toast(err.message);} }
  });
  $('#bulk-all').onclick=()=>{ visibleIds.forEach(id=>selIds.add(id)); renderProducts(); };
  $('#bulk-delete').onclick=async()=>{ if(!selIds.size){toast('حدّد منتجات أولاً.');return;} if(!confirm(`حذف ${selIds.size} منتج؟`))return; state.products=state.products.filter(x=>!selIds.has(x.id)); state.slides=state.slides.filter(x=>!selIds.has(x.productId)); selIds.clear(); await persist(); renderAll(); toast('تم الحذف.'); };

  async function refreshExchangeRate(silent=false){
    if(!window.taysirAPI?.getExchangeRate) return;
    try{ const r=await window.taysirAPI.getExchangeRate(); if(r.ok){ const old=Number(state.exchangeRate)||0; state.exchangeRate=r.value; state.exchangeBuy=r.buy; state.exchangeSell=r.sell; state.exchangeFetchedAt=r.fetchedAt; state.exchangeSource=r.source; state.exchangeManual=false; state.direction=old? (r.value>old?'up':r.value<old?'down':'flat') : 'flat'; await persist(); renderStats(); renderSettings(); renderCarousel(); if(!silent) toast(`تم تحديث سعر الصرف تلقائياً: ${money(r.value)} ل.س`); } else if(!silent) toast(r.error); }catch(e){ if(!silent) toast('تعذر تحديث سعر الصرف حالياً.'); }
  }

  async function init(){
    try{db=await openDB();const saved=await dbGet('state');if(saved)state=Object.assign(structuredClone(defaultState),saved); state.companies=Array.isArray(state.companies)?state.companies:[]; state.geminiConfigured=!!state.geminiConfigured; delete state.geminiKey; state.reviewQueue=Array.isArray(state.reviewQueue)?state.reviewQueue:[]; state.sourcePages=state.sourcePages||{}; state.suggestionHistory=Array.isArray(state.suggestionHistory)?state.suggestionHistory:[];
      state.business=Object.assign({address:'',shamCashBarcode:'',channelBarcode:'',ordersOpen:'09:00',ordersClose:'18:00'},state.business||{});
      renderAll(); if(window.taysirAPI?.geminiStatus){ try{const gs=await window.taysirAPI.geminiStatus(); state.geminiConfigured=!!gs?.configured; renderAll();}catch(_){ } } setTimeout(()=>refreshExchangeRate(true),300); setInterval(()=>refreshExchangeRate(true),5*60*1000);}
    catch(err){console.error(err);toast('تعذر فتح قاعدة البيانات المحلية. جرّب تشغيل البرنامج في متصفح حديث.');}
  }
  // ===== اسم المدير فقط — بدون تسجيل دخول أو حساب Google =====
  function managerNameGate(){
    const name=String(state.managerName||'').trim();
    if(name){document.body.classList.add('authed');return;}
    document.body.classList.remove('authed');
    $('#manager-name-gate')?.remove();
    document.body.insertAdjacentHTML('beforeend',`<div id="manager-name-gate" class="auth"><form class="auth-card" id="manager-name-form"><h2>التيسير</h2><p>قبل ما نبلّش، اكتب اسم المدير.</p><label>اسم المدير<input name="name" maxlength="60" autocomplete="name" required placeholder="مثال: محمد"></label><button class="primary-btn" type="submit">دخول إلى الإدارة</button><small class="muted" style="text-align:center">ما في تسجيل حساب، وما في Google Login. الاسم ينحفظ على هذا الجهاز فقط.</small></form></div>`);
    $('#manager-name-form').onsubmit=async e=>{e.preventDefault();const n=String(new FormData(e.target).get('name')||'').trim();if(n.length<2){toast('اكتب الاسم بشكل صحيح.');return;}state.managerName=n;await persist();$('#manager-name-gate').remove();document.body.classList.add('authed');renderAll();toast(`أهلاً ${n} 👋`);};
  }
  init().then(managerNameGate);
})();
