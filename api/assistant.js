const topicFor = (text='') => {
  const s=text.toLowerCase();
  if (/quality|contamin|taste|smell|لون|ريحة|طعم|تلوث|عكارة|صدأ/.test(s)) return 'quality';
  if (/farm|crop|irrigat|فلاح|زرع|محصول|الري|مزرعة/.test(s)) return 'irrigation';
  if (/leak|pipe|burst|تسريب|ماسورة|مواسير|كسر/.test(s)) return 'leak';
  if (/flood|rain|drain|فيضان|مطر|صرف/.test(s)) return 'flood';
  return 'scarcity';
};
const questions = (ar, topic) => ar ? [
  {id:'where',text:'المشكلة فين بالضبط؟ اسم قرية أو منطقة كفاية.',options:['بيت','مزرعة أو ري','مدرسة أو منشأة','منطقة كاملة','مكان تاني']},
  {id:'when',text:'بدأت إمتى وبتحصل باستمرار ولا على فترات؟',options:['بدأت قريب','مستمرة','موسمية أو متقطعة','مش متأكد']},
  {id:'source',text:'إيه مصدر المياه المتأثر؟',options:['شبكة عامة','بئر','ترعة أو نهر','خزان','مش عارف']},
  {id:'impact',text:'إيه أكتر حاجة اتأثرت؟',options:['الشرب أو الصحة','الري أو المحصول','التكلفة والوقت','توافر المياه','أوضح بنفسي']}
] : [
  {id:'where',text:'Where is this happening? A town or area is enough.',options:['Home','Farm or irrigation','School or facility','Whole community','Other']},
  {id:'when',text:'When did it start, and is it constant or intermittent?',options:['Recently','Ongoing','Seasonal or intermittent','Not sure']},
  {id:'source',text:'Which water source is affected?',options:['Public network','Well','Canal or river','Storage tank','Not sure']},
  {id:'impact',text:'What is most affected?',options:['Drinking or health','Irrigation or crops','Cost or time','Water availability','I will explain']}
];
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  const b=req.body||{}, ar=b.lang==='ar', desc=String(b.description||'').trim();
  if(desc.length<10 || desc.length>5000 || String(b.location||'').length>120) return res.status(400).json({error:ar?'اكتب وصفًا أطول قليلًا للمشكلة.':'Please describe the water problem in more detail.'});
  const topic=topicFor(desc);
  if(b.stage==='questions') return res.status(200).json({questions:questions(ar,topic),mode:'guided'});
  if(b.stage!=='result') return res.status(400).json({error:'Unknown assistant step'});
  let sources=[];
  try {
    const q={search:({quality:'water quality contamination',irrigation:'efficient irrigation water management',leak:'water distribution leakage',flood:'flood water drainage',scarcity:'water scarcity access'}[topic])+' '+String(b.location||''),per_page:'4',sort:'relevance_score:desc',mailto:'aquamind@example.org'};
    const r=await fetch('https://api.openalex.org/works?'+new URLSearchParams(q),{signal:AbortSignal.timeout(9000)});
    if(r.ok){const d=await r.json();sources=(d.results||[]).slice(0,4).map(w=>({title:w.display_name,year:w.publication_year,url:w.doi||w.primary_location?.landing_page_url||'https://openalex.org/'+w.id.split('/').pop(),publisher:w.primary_location?.source?.display_name||'OpenAlex'}));}
  } catch {}
  let causes,actions,summary,expert;
  if(topic==='quality'){
    causes=ar?[{title:'تغير في المصدر أو شبكة التوزيع',reason:'تغير اللون أو الرائحة قد يرتبط بالمصدر أو التخزين أو المواسير؛ الوصف وحده لا يحدد السبب.',confidence:'احتمال يحتاج فحصًا'},{title:'تلوث محتمل',reason:'لا يمكن تأكيد سلامة المياه عبر وصف أو صورة فقط.',confidence:'غير محسوم'}]:[{title:'A change in the source or distribution system',reason:'Colour or odour changes may relate to the source, storage, or plumbing; description alone cannot identify the cause.',confidence:'Needs testing'},{title:'Possible contamination',reason:'A chat cannot confirm whether water is safe.',confidence:'Unconfirmed'}];
    actions=ar?[{title:'لو فيه خطر صحي، أوقف استخدامها للشرب مؤقتًا',detail:'استخدم مصدرًا آمنًا واتصل بجهة المياه أو الصحة المحلية.',priority:'الآن'},{title:'اطلب تحليلًا من جهة معتمدة',detail:'سجّل وقت التغير ومصدر المياه وأي أعراض.',priority:'التالي'}]:[{title:'If a health risk is possible, pause drinking it',detail:'Use a known safe source and contact local water or public-health authorities.',priority:'Now'},{title:'Request testing from a qualified service',detail:'Record when the change began, the source, and any symptoms.',priority:'Next'}];
    expert=ar?'تواصل سريعًا مع جهة المياه أو الصحة المحلية، خصوصًا عند وجود أعراض.':'Contact local water or public-health authorities promptly, especially if anyone has symptoms.';
  } else if(topic==='irrigation'){
    causes=ar?[{title:'توقيت الري أو كفاءة التوزيع',reason:'عدم انتظام وصول المياه قد يرتبط بالجدولة أو تسرب أو انسداد.',confidence:'احتمال'},{title:'احتياج المحصول والطقس',reason:'الاحتياج يتغير حسب المحصول ومرحلة النمو والتربة والحرارة.',confidence:'احتمال'}]:[{title:'Irrigation timing or distribution efficiency',reason:'Uneven delivery can result from scheduling, leakage, or blocked outlets.',confidence:'Possible'},{title:'Crop and weather demand',reason:'Needs change with crop, growth stage, soil, and heat.',confidence:'Possible'}];
    actions=ar?[{title:'قارن وصول المياه بين أجزاء الأرض',detail:'سجّل المناطق المتأثرة ووقت الري وأي تسريب أو انسداد.',priority:'الآن'},{title:'راجع الجدول مع إرشاد زراعي محلي',detail:'ضع نوع المحصول ومرحلة نموه والتربة والطقس في الاعتبار.',priority:'التالي'}]:[{title:'Compare delivery across the field',detail:'Note affected areas, irrigation times, leaks, and blockages.',priority:'Now'},{title:'Review the schedule with local agricultural guidance',detail:'Consider crop, growth stage, soil, and weather.',priority:'Next'}];
    expert=ar?'استشر مهندسًا زراعيًا محليًا قبل تغييرات كبيرة في الري.':'Consult a local agricultural specialist before major irrigation changes.';
  } else {
    causes=ar?[{title:'تسرب أو عطل في التوزيع',reason:'قد يفسر انخفاض الضغط أو الانقطاع إذا كانت المشكلة محلية أو بدأت فجأة.',confidence:'احتمال'},{title:'طلب أعلى أو إمداد محدود',reason:'تأثر أكثر من منطقة قد يشير لضغط على المصدر أو الشبكة.',confidence:'احتمال'}]:[{title:'Leakage or distribution fault',reason:'May explain a local pressure drop or sudden interruption.',confidence:'Possible'},{title:'Higher demand or limited supply',reason:'Several affected areas may point to pressure on the source or network.',confidence:'Possible'}];
    actions=ar?[{title:'حدد نطاق المشكلة',detail:'اسأل الجيران أو الجهة المسؤولة هل التأثر محلي أم عام، وسجّل الأوقات.',priority:'الآن'},{title:'أبلغ جهة المياه عن التسرب أو الانقطاع',detail:'شارك المنطقة ووقت البداية وأي ملاحظات واضحة.',priority:'التالي'}]:[{title:'Map how widespread the issue is',detail:'Check whether nearby households are affected and note when it occurs.',priority:'Now'},{title:'Report leaks or outages to the water provider',detail:'Share the broad area, start time, and clear observations.',priority:'Next'}];
    expert=ar?'لو المشكلة مستمرة، تواصل مع الجهة المحلية المسؤولة عن المياه.':'If the issue continues, contact your local water provider.';
  }
  summary=ar?'من وصفك، دي قراءة أولية تساعدك ترتب الاحتمالات والخطوات. محتاجين معلومات أو فحص محلي لتأكيد السبب.':'This is an initial assessment to organize possible causes and next steps. More details or local testing are needed to confirm the cause.';
  if(process.env.OPENAI_API_KEY){
    try {
      const prompt='Use web search. Respond JSON only: {"summary":"...","causes":[{"title":"...","reason":"...","confidence":"..."}],"actions":[{"title":"...","detail":"...","priority":"..."}],"uncertainties":[],"expert":"...","sources":[]}. Be cautious, practical, and cite relevant sources. Do not claim water safety. Respond in '+(ar?'Arabic':'English')+'. Situation: '+JSON.stringify({description:desc,answers:b.answers,location:b.location,context:b.context});
      const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4.1-mini',tools:[{type:'web_search'}],input:prompt,text:{format:{type:'json_object'}}}),signal:AbortSignal.timeout(55000)});
      if(r.ok){const d=await r.json(),t=d.output?.flatMap(x=>x.content||[]).find(x=>x.type==='output_text')?.text;if(t){const ai=JSON.parse(t);return res.status(200).json({result:ai,mode:'ai'});}}
    }catch{}
  }
  return res.status(200).json({result:{summary,causes,actions,uncertainties:ar?['السبب غير مؤكد من الوصف وحده.','نتائج البحث الأكاديمي لا تثبت حالة موقعك تحديدًا.']:['The cause cannot be confirmed from description alone.','Research results do not verify conditions at your specific location.'],expert,sources},mode:'research-preview'});
}
