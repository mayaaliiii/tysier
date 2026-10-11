/* مساعد التيسير الذكي — اقتراحات محلية مجانية + اعتماد/رفض/تعديل فعلي + اقتراح صور.
   القاعدة: المساعد يقترح فقط، ولا يُحفظ شيء قبل ضغط «اعتماد». */
(() => {
  'use strict';
  if (!window.TaysirCore) return;
  const { $, esc, toast, openProductModal, fileToDataUrl, getState, addSlide, uid } = window.TaysirCore;
  let cur = null; // { type:'product'|'slider', data:{}, images:[{src,label,kind}], sel:-1, editing:false }

  /* ---------- النصوص ---------- */
  const CATS = [[/علب|تخزين|مطربان|حافظة|برطمان/, 'أدوات منزلية'], [/كوب|كاسات|كاس|نايلون|أكياس|كيس|بلاستيك|صحون|صحن/, 'بلاستيك ومستلزمات'], [/مكنسة|مسّاحة|ممسحة|تنظيف|منظف/, 'أدوات تنظيف'], [/لعبة|ألعاب/, 'ألعاب']];
  function guessCategory(text) {
    const known = [...new Set(getState().products.map(p => p.category).filter(Boolean))];
    const hit = known.find(c => c && text.includes(c)); if (hit) return hit;
    const m = CATS.find(([re]) => re.test(text)); return m ? m[1] : (known[0] || 'غير مصنف');
  }
  function productSuggestion(name, info) {
    const cat = guessCategory(name + ' ' + info);
    return {
      'الاسم': name || 'منتج جديد', 'التصنيف': cat,
      'الوصف': `${name || 'منتج'} عملي بجودة مناسبة للاستخدام اليومي.${info ? ' ' + info : ''}`.trim(),
      'كلمات مفتاحية': [name, 'مركز التيسير', cat].filter(Boolean).join('، '),
      'عنوان قصير': name || 'منتج جديد',
      'فكرة التسويق': 'اعرض المنتج بخلفية نظيفة، وأبرز الفائدة الأساسية والسعر وهوية الشركة إن وُجدت.'
    };
  }
  function sliderSuggestion(name) {
    return {
      'العنوان': name, 'الوصف': 'مختارات من التيسير — منتج عملي بتقديم بصري راقٍ.',
      'فكرة التصميم 1': 'تصوير فاخر بإضاءة استوديو ومساحة نظيفة للنص.',
      'فكرة التصميم 2': 'مشهد استخدام واقعي يوضح فائدة المنتج.',
      'فكرة التصميم 3': 'تصميم داكن وذهبي مع اسم مركز التيسير وشعار الشركة عند اختياره.'
    };
  }

  /* ---------- الصور ---------- */
  const loadImg = src => new Promise(res => { if (!src) return res(null); const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  function contain(ctx, img, x, y, w, h) { const r = Math.min(w / img.width, h / img.height), dw = img.width * r, dh = img.height * r; ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); }
  function cover(ctx, img, x, y, w, h) { const r = Math.max(w / img.width, h / img.height), dw = img.width * r, dh = img.height * r; ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); }
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function wrap(ctx, text, maxW, maxLines) {
    const words = String(text).split(/\s+/), lines = []; let line = '';
    for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line); return lines.slice(0, maxLines);
  }
  function diamond(ctx, cx, cy, s, stroke) { ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.PI / 4); ctx.strokeStyle = stroke; ctx.lineWidth = 3; ctx.strokeRect(-s / 2, -s / 2, s, s); ctx.restore(); }
  async function makeDesigns(title, subtitle, photoSrc, logoSrc) {
    const [photo, logo] = await Promise.all([loadImg(photoSrc), loadImg(logoSrc)]);
    try { await document.fonts.ready; } catch (_) {}
    const F = 'Cairo, "Segoe UI", Tahoma, Arial, sans-serif', W = 1200, H = 600, out = [];
    const make = (label, paint) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.direction = 'rtl'; x.textAlign = 'right'; x.textBaseline = 'alphabetic'; paint(x); out.push({ src: c.toDataURL('image/jpeg', 0.88), label, kind: 'design' }); };
    const textBlock = (x, color, sub, right, maxW) => {
      x.fillStyle = '#d9b56a'; x.font = `700 26px ${F}`; x.fillText('✦ مختارات التيسير', right, 120);
      x.fillStyle = color; x.font = `800 62px ${F}`; const L = wrap(x, title, maxW, 3); L.forEach((l, i) => x.fillText(l, right, 205 + i * 78));
      x.fillStyle = sub; x.font = `500 28px ${F}`; wrap(x, subtitle, maxW, 2).forEach((l, i) => x.fillText(l, right, 205 + L.length * 78 + 20 + i * 40));
      x.fillStyle = color; x.font = `700 24px ${F}`; x.fillText('مركز التيسير', right, 548);
    };
    make('داكن فاخر', x => {
      const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#0b0b0c'); g.addColorStop(1, '#221d12'); x.fillStyle = g; x.fillRect(0, 0, W, H);
      x.strokeStyle = '#d9b56a'; x.lineWidth = 2; x.strokeRect(24, 24, W - 48, H - 48);
      x.save(); rr(x, 70, 80, 470, 440, 26); x.fillStyle = '#16161a'; x.fill(); x.clip();
      if (photo) contain(x, photo, 90, 100, 430, 400); else if (logo) contain(x, logo, 150, 160, 310, 280); else diamond(x, 305, 300, 170, '#d9b56a'); x.restore();
      textBlock(x, '#ffffff', '#cfcabd', W - 80, 560);
      if (logo && photo) { x.save(); rr(x, 90, 440, 72, 72, 12); x.fillStyle = '#f2f2f2'; x.fill(); x.clip(); contain(x, logo, 94, 444, 64, 64); x.restore(); }
    });
    make('ذهبي', x => {
      const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#f0d38d'); g.addColorStop(1, '#c99a45'); x.fillStyle = g; x.fillRect(0, 0, W, H);
      x.save(); x.beginPath(); x.arc(310, 300, 215, 0, Math.PI * 2); x.fillStyle = '#fff8e6'; x.fill(); x.clip();
      if (photo) contain(x, photo, 110, 100, 400, 400); else if (logo) contain(x, logo, 190, 180, 240, 240); else diamond(x, 310, 300, 150, '#c99a45'); x.restore();
      x.fillStyle = '#17130a'; x.font = `700 26px ${F}`; x.fillText('✦ مختارات التيسير', W - 80, 120);
      textBlock(x, '#17130a', '#3a2f17', W - 80, 560);
    });
    make('صورة كاملة', x => {
      x.fillStyle = '#0b0b0c'; x.fillRect(0, 0, W, H);
      if (photo) cover(x, photo, 0, 0, W, H); else { for (let i = 0; i < 9; i++) diamond(x, 100 + i * 125, 150 + (i % 2) * 140, 90, 'rgba(217,181,106,.35)'); if (logo) contain(x, logo, 480, 90, 240, 240); }
      const g = x.createLinearGradient(0, H * 0.35, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.9)'); x.fillStyle = g; x.fillRect(0, 0, W, H);
      x.fillStyle = '#d9b56a'; x.font = `700 24px ${F}`; x.fillText('✦ مختارات التيسير', W - 60, 400);
      x.fillStyle = '#fff'; x.font = `800 56px ${F}`; const L = wrap(x, title, 1000, 2); L.forEach((l, i) => x.fillText(l, W - 60, 465 + i * 66));
      x.fillStyle = '#d8d3c6'; x.font = `500 26px ${F}`; x.fillText(wrap(x, subtitle, 1000, 1)[0] || '', W - 60, 465 + L.length * 66 + 8);
    });
    return out;
  }
  function libraryImages(name) {
    const toks = String(name).split(/\s+/).filter(t => t.length >= 3);
    return getState().products.filter(p => p.image).map(p => ({ p, s: toks.filter(t => p.name.includes(t)).length })).filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s).slice(0, 3).map(x => ({ src: x.p.image, label: 'من المكتبة: ' + x.p.name, kind: 'photo' }));
  }

  /* ---------- العرض ---------- */
  function render() {
    const root = $('#ai-result-body');
    if (!cur) { root.innerHTML = '<div class="empty">اكتب اسم المنتج ثم اطلب اقتراحاً.</div>'; return; }
    const title = cur.type === 'product' ? 'اقتراح محتوى المنتج' : 'أفكار مختارات التيسير';
    if (cur.editing) {
      root.innerHTML = `<div class="suggestion ai-edit"><strong>تعديل المقترح</strong>${Object.entries(cur.data).map(([k, v], i) => `<label>${esc(k)}${String(v).length > 60 ? `<textarea data-k="${i}" rows="3">${esc(v)}</textarea>` : `<input data-k="${i}" value="${esc(v)}">`}</label>`).join('')}</div><div class="ai-actions"><button class="primary-btn" id="ai-save-edit" type="button">✓ حفظ التعديلات</button><button class="secondary-btn" id="ai-cancel-edit" type="button">إلغاء</button></div>`;
      return;
    }
    const imgs = cur.images.length ? `<div class="suggestion"><strong>🖼️ صور مقترحة — اضغط لاختيار صورة</strong><div class="ai-imgs">${cur.images.map((im, i) => `<button type="button" data-img="${i}" class="${cur.sel === i ? 'sel' : ''}"><img src="${im.src}" alt=""><span>${esc(im.label)}</span></button>`).join('')}</div></div>`
      : `<div class="suggestion"><strong>🖼️ الصور</strong><p class="muted">لا توجد صورة مطابقة في المكتبة. ارفع صورة المنتج من الحقل على اليمين ثم أعد الاقتراح، وستظهر لك تصاميم جاهزة. (توليد صور بالذكاء الاصطناعي أو جلب صور من الإنترنت يحتاج خدمة خارجية ومفتاحاً.)</p></div>`;
    root.innerHTML = `<div class="suggestion"><strong>${title}</strong><div>${Object.entries(cur.data).map(([k, v]) => `<p><b>${esc(k)}:</b> ${esc(v)}</p>`).join('')}</div></div>${imgs}<div class="ai-actions"><button class="primary-btn" id="ai-approve" type="button">✓ اعتماد</button><button class="secondary-btn" id="ai-reject" type="button">✕ رفض</button><button class="secondary-btn" id="ai-edit" type="button">✎ تعديل</button></div>`;
  }

  async function suggest(type) {
    const name = $('#ai-product-name').value.trim(), info = $('#ai-product-info').value.trim();
    if (!name) { toast('اكتب اسم المنتج أولاً.'); return; }
    const btn = type === 'product' ? $('#ai-suggest-product') : $('#ai-suggest-slider'); btn.disabled = true;
    try {
      let upload = ''; const f = $('#ai-product-image').files[0]; if (f) upload = await fileToDataUrl(f);
      const company = getState().companies.find(c => c.id === $('#ai-company').value); const logo = company?.logo || '';
      const photos = [...(upload ? [{ src: upload, label: 'صورتك المرفوعة', kind: 'photo' }] : []), ...libraryImages(name)];
      let images = [...photos];
      if (type === 'slider') { const d = await makeDesigns(name, 'مختارات من التيسير — منتج عملي بتقديم بصري راقٍ.', photos[0]?.src || '', logo); images = [...d, ...photos]; }
      if (logo && type === 'product') images.push({ src: logo, label: 'شعار ' + company.name, kind: 'logo' });
      cur = { type, data: type === 'product' ? productSuggestion(name, info) : sliderSuggestion(name), images, sel: images.length ? 0 : -1, editing: false, logo, photoSrc: photos[0]?.src || '' };
      render();
    } catch (e) { toast(e.message || 'تعذر إنشاء الاقتراح.'); } finally { btn.disabled = false; }
  }

  async function approve() {
    if (!cur) return;
    const img = cur.sel >= 0 ? cur.images[cur.sel]?.src || '' : '';
    if (cur.type === 'product') {
      const d = cur.data; openProductModal(null, { name: d['الاسم'], code: '', category: d['التصنيف'], priceUsd: '', priceSyp: '', description: d['الوصف'], image: img });
      toast('راجع السعر ثم احفظ المنتج — لم يُحفظ شيء بعد.');
    } else {
      const d = cur.data; await addSlide({ id: uid('slide'), title: d['العنوان'], subtitle: d['الوصف'], image: img, order: 0, createdAt: Date.now(), productId: null });
      toast('تمت إضافة الشريحة إلى مختارات التيسير.'); cur = null; render();
    }
  }

  /* ---------- الأحداث ---------- */
  $('#ai-suggest-product').onclick = () => suggest('product');
  $('#ai-suggest-slider').onclick = () => suggest('slider');
  $('#ai-result-body').addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t || !cur) return;
    if (t.dataset.img !== undefined) { cur.sel = cur.sel === +t.dataset.img ? -1 : +t.dataset.img; render(); }
    else if (t.id === 'ai-approve') approve();
    else if (t.id === 'ai-reject') { cur = null; render(); toast('تم رفض المقترح — لم يُحفظ شيء.'); }
    else if (t.id === 'ai-edit') { cur.editing = true; render(); }
    else if (t.id === 'ai-cancel-edit') { cur.editing = false; render(); }
    else if (t.id === 'ai-save-edit') { const keys = Object.keys(cur.data); document.querySelectorAll('#ai-result-body [data-k]').forEach(el => { cur.data[keys[+el.dataset.k]] = el.value.trim(); }); cur.editing = false; render(); toast('تم حفظ التعديلات — اضغط اعتماد عند الجاهزية.'); }
  });
  document.addEventListener('taysir:rendered', () => {
    const sel = $('#ai-company'); if (!sel) return; const v = sel.value;
    sel.innerHTML = '<option value="">— بدون —</option>' + getState().companies.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join(''); sel.value = v;
  });
  document.dispatchEvent(new Event('taysir:rendered'));
})();
