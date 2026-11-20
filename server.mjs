import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./', import.meta.url));
const port = Number(process.env.PORT || 4173);
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml' };

function send(res, status, body, type='application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
async function readJson(req) {
  let raw=''; for await (const part of req) { raw += part; if (raw.length > 18000) throw new Error('Request too large'); }
  return JSON.parse(raw || '{}');
}
function inferTopic(text='') {
  const s=text.toLowerCase();
  if (/quality|contamin|smell|taste|لون|ريحة|طعم|تلوث|ملوث|عكارة|صدأ/.test(s)) return 'water quality and safety';
  if (/farm|crop|irrigat|فلاح|زرع|محصول|ري |الري|ارض|أرض/.test(s)) return 'agricultural water use and irrigation';
  if (/leak|pipe|burst|تسريب|ماسورة|مواسير|كسر/.test(s)) return 'water leakage and distribution';
  if (/flood|rain|drain|فيضان|مطر|صرف/.test(s)) return 'flooding, rainfall and drainage';
  return 'water scarcity and access';
}
function fallbackQuestions(body) {
  const topic = inferTopic(body.description);
  const ar = body.lang === 'ar';
  const q = ar ? [
    { id:'where', text:'أين تظهر المشكلة؟ اكتب القرية أو المدينة أو المنطقة، من غير عنوانك بالتفصيل.', options:['في البيت','في مزرعة','في مدرسة أو منشأة','على مستوى مجتمع/منطقة','مكان آخر'] },
    { id:'since', text:'من إمتى بدأت المشكلة؟ وهل بتزيد ولا بتيجي وتروح؟', options:['بدأت مؤخرًا','مستمرة من فترة','بتظهر أوقات معينة','مش متأكد'] },
    { id:'source', text:'إيه مصدر المياه أو النظام المتأثر؟', options:['شبكة عامة','بئر','ترعة/نهر','خزان','مش متأكد'] },
    { id:'impact', text:'إيه أكتر حاجة اتأثرت، وإيه الموارد المتاحة للتعامل؟', options:['صحة أو شرب','ري أو محصول','تكلفة أو وقت','توافر المياه','عايز أوضح بنفسي'] },
  ] : [
    { id:'where', text:'Where is this happening? Share a town or area only; no exact address is needed.', options:['Home','Farm','School or facility','Community or region','Somewhere else'] },
    { id:'since', text:'When did it begin, and is it getting worse or happening intermittently?', options:['Recently','Ongoing','Intermittent or seasonal','Not sure'] },
    { id:'source', text:'Which water source or system is affected?', options:['Public network','Well','Canal or river','Storage tank','Not sure'] },
    { id:'impact', text:'What is most affected, and what resources are available to respond?', options:['Health or drinking','Irrigation or crops','Cost or time','Water availability','I will explain'] },
  ];
  if (/quality|safety|جودة|شرب|ريحة|طعم|تلوث|لون/.test(topic + ' ' + body.description.toLowerCase())) {
    q[2] = ar ? {id:'signs',text:'هل تغير اللون أو الطعم أو الرائحة؟ وهل حصل مرض بعد استخدام المياه؟',options:['تغير ملحوظ','فيه أعراض صحية','لا يوجد تغير واضح','غير معروف']} : {id:'signs',text:'Has the water’s colour, taste, or smell changed, or has anyone felt ill after using it?',options:['Visible change','Health symptoms','No clear change','Not sure']};
  }
  return q;
}
function parseModelJson(text) {
  const clean = text.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  return JSON.parse(clean);
}
async function aiCall(payload) {
  if (!process.env.OPENAI_API_KEY) return null;
  const prompt = payload.stage === 'questions'
    ? `You are AQUA MIND, a careful water-problem triage assistant. Read the user's description and return JSON only: {"questions":[{"id":"short_id","text":"one clear question","options":["choice", "choice"]}]}. Ask at most 4 questions that fill important information gaps. Do not repeat details already supplied. Avoid requesting exact addresses or personal data. Adapt wording to the user's language (${payload.lang}) and context. Problem: ${payload.description}`
    : `You are AQUA MIND, a cautious, multilingual water-problem research assistant. Use web search to research this specific situation. Prefer peer-reviewed research and primary sources such as FAO, WHO, UN-Water, UNESCO, and local authorities. Never claim a cause is confirmed unless the evidence supports it. Return JSON only with this shape: {"summary":"...","causes":[{"title":"...","reason":"...","confidence":"Possible|More likely|Unclear"}],"actions":[{"title":"...","detail":"...","priority":"Now|Next|Later"}],"uncertainties":["..."],"expert":"...","sources":[{"title":"...","url":"https://...","publisher":"..."}]}. Give practical, low-risk next steps. For suspected unsafe drinking water, do not certify safety; recommend local testing/authority guidance. Include 3-6 genuinely relevant source URLs. Respond in ${payload.lang === 'ar' ? 'Arabic' : 'English'}. User situation: ${JSON.stringify({description:payload.description,answers:payload.answers,location:payload.location,context:payload.context})}`;
  const resp = await fetch('https://api.openai.com/v1/responses', {
    method:'POST', headers:{'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify({model:process.env.OPENAI_MODEL || 'gpt-4.1-mini', tools:payload.stage === 'result' ? [{type:'web_search'}] : [], input:prompt, text:{format:{type:'json_object'}}}),
    signal:AbortSignal.timeout(65000)
  });
  if (!resp.ok) throw new Error(`AI service returned ${resp.status}`);
  const data=await resp.json();
  const text=data.output?.flatMap(x=>x.content||[]).find(x=>x.type==='output_text')?.text || data.output_text;
  if (!text) throw new Error('No response text');
  return parseModelJson(text);
}
async function research(topic, lang) {
  const params=new URLSearchParams({ search:topic, per_page:'5', sort:'relevance_score:desc', mailto:'aqu amind@example.org'.replace(' ', '') });
  const r=await fetch(`https://api.openalex.org/works?${params}`,{signal:AbortSignal.timeout(12000),headers:{'Accept':'application/json'}});
  if (!r.ok) throw new Error('Research service unavailable');
  const d=await r.json();
  return (d.results||[]).slice(0,5).map(w=>({title:w.display_name,year:w.publication_year,url:w.doi||w.primary_location?.landing_page_url||`https://openalex.org/${w.id?.split('/').pop()}`,publisher:w.primary_location?.source?.display_name||'OpenAlex'}));
}
function fallbackResult(body, sources) {
  const ar=body.lang==='ar'; const topic=inferTopic(body.description); const desc=body.description||'';
  let causes, actions;
  if(topic.includes('quality')) {
    causes=ar?[{title:'تغير في المصدر أو شبكة التوزيع',reason:'تغير اللون أو الطعم أو الرائحة قد يرتبط بالمصدر أو التخزين أو المواسير؛ الوصف وحده لا يحدد السبب.',confidence:'احتمال يحتاج فحص'},{title:'تلوث محتمل',reason:'لا يمكن تأكيد سلامة المياه أو نفيها من المحادثة فقط.',confidence:'غير محسوم'}]:[{title:'A change in the source or distribution system',reason:'Changes in colour, taste, or smell can relate to the source, storage, or plumbing; a description alone cannot identify the cause.',confidence:'Needs testing'},{title:'Possible contamination',reason:'A chat cannot confirm whether water is safe or unsafe.',confidence:'Unconfirmed'}];
    actions=ar?[{title:'لو فيه خطر صحي، أوقف الاستخدام للشرب والطهي مؤقتًا',detail:'استخدم مصدرًا آمنًا واتصل بجهة المياه أو الصحة المحلية لمعرفة الإجراء المناسب.',priority:'الآن'},{title:'اطلب تحليلًا من جهة معتمدة',detail:'سجّل وقت التغير ومصدر المياه وأي أعراض، ولا تعتمد على الشكل أو الرائحة وحدهما.',priority:'الخطوة التالية'}]:[{title:'If health risk is possible, pause drinking and cooking with it',detail:'Use a known safe source and contact the local water or public-health authority for instructions.',priority:'Now'},{title:'Request testing from a qualified local service',detail:'Record when the change began and which source is affected; appearance or smell alone cannot establish safety.',priority:'Next'}];
  } else if(topic.includes('agricultural')) {
    causes=ar?[{title:'توقيت أو كفاءة توزيع الري',reason:'وصول المياه بشكل غير متساوٍ قد ينتج عن الجدولة أو التسرب أو انسداد نقاط التوزيع.',confidence:'احتمال'},{title:'طلب المحصول والطقس',reason:'احتياج المياه يتغير حسب المحصول ومرحلة النمو والحرارة والتربة.',confidence:'احتمال'}]:[{title:'Irrigation timing or distribution efficiency',reason:'Uneven delivery can result from scheduling, leakage, or blocked outlets.',confidence:'Possible'},{title:'Crop and weather demand',reason:'Water needs change with crop type, growth stage, heat, and soil conditions.',confidence:'Possible'}];
    actions=ar?[{title:'قارن وصول المياه بين أجزاء الحقل',detail:'سجّل المناطق المتأثرة ووقت الري وأي انسداد أو تسرب ظاهر.',priority:'الآن'},{title:'راجع توقيت الري مع إرشاد زراعي محلي',detail:'خد نوع المحصول ومرحلة نموه ونوع التربة والطقس في الاعتبار قبل تعديل كمية المياه.',priority:'الخطوة التالية'}]:[{title:'Compare delivery across the field',detail:'Note affected areas, irrigation times, and any visible blockage or leakage.',priority:'Now'},{title:'Review scheduling with local agricultural guidance',detail:'Consider crop type, growth stage, soil, and weather before changing application amounts.',priority:'Next'}];
  } else {
    causes=ar?[{title:'تسرب أو عطل في التوزيع',reason:'قد يفسر انخفاض الضغط أو الانقطاع إذا كانت المشكلة محلية أو بدأت فجأة.',confidence:'احتمال'},{title:'زيادة الطلب أو محدودية الإمداد',reason:'إذا تأثرت مناطق أو أوقات متعددة، قد يرتبط السبب بضغط على المصدر أو الشبكة.',confidence:'احتمال'}]:[{title:'Leakage or a distribution fault',reason:'This may explain low pressure or an interruption when the issue is local or began suddenly.',confidence:'Possible'},{title:'Higher demand or limited supply',reason:'If several areas or times are affected, pressure on the source or network may be involved.',confidence:'Possible'}];
    actions=ar?[{title:'حدد نطاق المشكلة',detail:'اسأل الجيران أو الجهة المسؤولة هل المشكلة في مبنى واحد أم المنطقة كلها، وسجّل أوقات حدوثها.',priority:'الآن'},{title:'افحص التسربات الظاهرة وتواصل مع الجهة المسؤولة',detail:'لا تفتح معدات أو خطوطًا مضغوطة بنفسك؛ بلّغ عن مكان العطل واطلب فحصًا مختصًا.',priority:'الخطوة التالية'}]:[{title:'Map how widespread the issue is',detail:'Check whether neighbours or nearby sites are affected and note when it happens.',priority:'Now'},{title:'Check for visible leaks and contact the responsible provider',detail:'Do not open pressurized equipment yourself; report the location and request an inspection.',priority:'Next'}];
  }
  return {summary:ar?`قراءة أولية لمشكلتك: ${desc}\n\nدي احتمالات للبحث وليست تشخيصًا مؤكدًا.`:`A first look at your report: ${desc}\n\nThese are possibilities to investigate, not a confirmed diagnosis.`,causes,actions,uncertainties:ar?['الوصف والإجابات لا تكفي لتأكيد السبب.','النتيجة تعتمد على معلومات محلية وفحص ميداني عند الحاجة.']:['The description and answers are not enough to confirm a cause.','Local records or an on-site inspection may be needed.'],expert:ar?'لو المشكلة مستمرة أو فيها خطر صحي/تشغيلي، تواصل مع جهة المياه المحلية أو مختص مؤهل.':'If the issue persists or could affect health or operations, contact the local water authority or a qualified professional.',sources};
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET' && url.pathname==='/api/status') return send(res,200,{ai:Boolean(process.env.OPENAI_API_KEY),research:'OpenAlex'});
  if(req.method==='POST' && url.pathname==='/api/assistant') {
    try {
      const body=await readJson(req);
      if(typeof body.description!=='string'||body.description.trim().length<10) return send(res,400,{error:'Please describe the water problem in more detail.'});
      if(body.stage==='questions') {
        const ai=await aiCall(body).catch(()=>null);
        return send(res,200,{questions:ai?.questions?.slice(0,4)||fallbackQuestions(body),mode:ai?'ai':'guided'});
      }
      const topic=inferTopic(body.description);
      let sources=[]; try { sources=await research(`${topic} ${body.location||''}`,body.lang); } catch {}
      const ai=await aiCall(body).catch(()=>null);
      return send(res,200,{result:ai||fallbackResult(body,sources),mode:ai?'ai':'research-preview'});
    } catch(e) { return send(res,500,{error:e.message||'Something went wrong.'}); }
  }
  if(req.method!=='GET') return send(res,405,{error:'Method not allowed'});
  const rel=decodeURIComponent(url.pathname==='/'?'index.html':url.pathname.slice(1));
  const target=normalize(join(root,rel));
  if(!target.startsWith(root)) return send(res,403,'Forbidden','text/plain');
  try { const data=await readFile(target); res.writeHead(200,{'Content-Type':mime[extname(target)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(data); }
  catch { send(res,404,'Not found','text/plain; charset=utf-8'); }
});
server.listen(port,()=>console.log(`AQUA MIND is ready at http://localhost:${port}`));
