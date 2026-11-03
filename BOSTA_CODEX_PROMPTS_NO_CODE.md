# Bosta Analysis — برومبتات Codex الكاملة (بدون أكواد داخل الوثيقة)

**كيفية الاستخدام:** مرّر البرومبت الأساسي أولًا، ثم نفّذ المراحل بالترتيب 00 → 08. كل برومبت يطلب من Codex **التعديل والتنفيذ مباشرة داخل الريبو**، لا إرسال مقاطع كود في المحادثة. تحقق من نتيجة مرحلة قبل التالية. أرفق معه وثيقة `BOSTA_TEXT_ONLY_EXECUTION_REFERENCE.md` وملف رأس أعمدة Bosta الأصلي أو قاموس الأعمدة الـ211 المضمن في المرجع. المستودع `osamaabdelmordy77/bosta-analysis`، الفرع الحالي `main`.

---
## البرومبت الأساسي — إلزامي قبل جميع المراحل

**الدور:** أنت Principal Software Architect + Laravel/MySQL Performance Engineer + React Engineer + QA Lead. اعمل على الريبو الفعلي `osamaabdelmordy77/bosta-analysis`. اقرأ كامل ملفات المصدر ذات الصلة، وليس التوثيق فقط. التزم بوثيقة `BOSTA_TEXT_ONLY_EXECUTION_REFERENCE.md` وقاموسها الكامل 211/211، ثم طبّق التنفيذ فعليًا داخل الملفات.

**قواعد عمل إجبارية:**
- أنشئ فرع عمل جديدًا ولا تعدّل `main` مباشرة. لا تعمل Push أو Merge أو Deploy إلا بإذن صريح.
- قبل أي تعديل: وثّق خريطة الملفات والتدفق الحالي، الأخطاء الحرجة، أي شكوك تتطلب عينة بيانات؛ احفظ تقرير BASELINE.
- لا تحذف أو تكسر خصائص React الموجودة. لا تكرر منطق KPI بين Laravel وReact. واجهة React تستقبل بيانات مجمعة من السيرفر فقط.
- كل عمود مصدر له حقل فيزيائي محدد، أو ثمانية حقول مهيكلة في جدول المحاولات بحسب group؛ لا تُخفِ أي عمود داخل JSON كحل بديل. استخدم JSON للإعدادات فقط.
- 211/211 تغطية آلية، اختبارات ثابتة، ومراجعة لسجلات Tracking ذات الأصفار، المال، وتنسيقات التاريخ.
- لا تعرض نتائج الاستيراد قبل اكتمال نشر النسخة الجديدة. اجعل كل job قابلة لإعادة المحاولة دون تكرار. لا تعطل واجهة التحليلات بسبب استيراد كبير.
- نفّذ ومثبت اختبارات Unit/Integration/Load ببيانات مصطنعة لا تحتوي PII. لا تتجاهل الأخطاء ولا تعتبر فشل API قيمة 0.
- اتبع أحدث مراجع Laravel/MySQL/حزم React المتوافقة مع بيئة المشروع. لا تثبّت مكتبة بشكل أعمى؛ تحقق من التوافق والرخصة.
- عند نهاية كل مرحلة: ملخص ما تغير، الملفات المعدّلة، نتائج الاختبارات بالأوامر والنتائج، مخاطر متبقية، خطوات Rollback. لا تسجل اختبارًا لم يُنفذ على أنه ناجح.
- إذا كانت قاعدة البيانات/Redis أو صلاحيات السيرفر غير متاحة، لا تدّعي نجاح تشغيل أو Benchmark؛ جهز الاختبارات والتوثيق واجعل القيد واضحًا.

**نطاق التنفيذ النهائي:** Laravel API Modular Monolith، MySQL InnoDB مع فهارس مبنية على Query Plans، Redis Queues/Horizon، تخزين آمن للملفات، Excel Preview & Mapping، Staging + Chunk Jobs + Atomic Publish، RBAC، API Analytics، React Modular Dashboard، Exports، Audit، Performance/Security Tests.

---
## المرحلة 00 — Audit + مواصفات نهائية وقاعدة أرقام مرجعية

حلّل الريبو ملفًا ملفًا وتتبّع `App.tsx`, `src/services/db.ts`, `excelService.ts`, `excelParser.ts`, `analytics.ts`, `dateExtractor.ts` وكل Component. لا تعتمد على docs/ فقط. اعمل جدولًا بما يجب الحفاظ عليه وما يجب إزالته أو ترحيله. ارجع إلى ملف Bosta النموذجي ورؤوسه الـ211؛ افصل القواعد المؤكدة عن الافتراضات غير المحسومة. وثّق نطاق `Tracking Number`، أولوية `report_date`، سياق `Attempt` غير المرقم، سياسة الاستبدال والتكرار، الفرق بين Unique Shipments وReport Observations، ومتى تعتبر بيانات الجداول مكتملة. أضف عينات Fixture مصطنعة تشمل أرقام تتبع متكررة، تواريخ خاطئة، XLSX متعدد الأوراق، Attempt 0..8، قيم فارغة وأرقام مالية. ابنِ Golden Dataset بالمؤشرات المتوقعة، واختبارات توثق أخطاء النسخة القديمة دون تغيير معاني الأرقام بصمت. وثّق مصادر PII. لا تنفذ ترحيلًا مدمرًا الآن.

**معايير قبول:** جرد ملفات ومخاطر، قاموس 211/211، Business Rules Decision Log، Golden Dataset، وقائمة فحوص واضحة قبل بدء Schema.

---
## المرحلة 01 — MySQL Schema + Migrations + Models + Index Matrix

أنشئ Backend Laravel داخل `backend/` مع تهيئة MySQL بإصدارات متوافقة. صمّم Migration مستقلة ومنظمة لكل مجموعة جداول من المرجع، مع Foreign Keys وUnique Constraints ونطاق مؤسسة ثابت. أنشئ جداول organizations/users/membership/roles/permissions/Hub Access، import_files/import_runs/import_sheets/import_chunks/import_issues/column_mappings، shipments + snapshots + five typed groups including snapshot main، وdelivery_attempts لعدد 9 مجموعات؛ أضف dimensions وaudit وexports. غطِّ جميع حقول الـ211 كأعمدة مهيكلة واضحة بالنوع المناسب، وتحقق برمجيًا من تغطية المصدر وأسماء الأعمدة 1:1. لا تجعل ملف الاسم معرفًا فريدًا؛ استعمل UUID/ULID/ID داخلي وSHA-256 وRevision. احفظ raw source labels. افصل report_date عن event datetime. Phone/tracking/external codes نصوص، المال DECIMAL، nullability حسب العينة والاعتماد. أنشئ Models بعلاقات سليمة وScopes للمؤسسة، وحماية Mass Assignment وسياسات Masking. ضع Index Matrix أولي وقم بمراجعة اليسار الأول Leftmost Prefix، ولا تضف 211 index. اعرض قرارات Optimization التي تحتاج بيانات حقيقية وEXPLAIN، وأنشئ Migration للـReporting Projection فقط إذا كان الضروري مُثبتًا.

**معايير قبول:** Migrate fresh وrollback على قاعدة اختبار، كل العلاقات تعمل، Integrity constraints ناجحة، اختبار 211/211، ولا يمكن لصفين من نفس chunk/retry تكوين سجلات مكررة.

---
## المرحلة 02 — مصادقة وصلاحيات ونطاق بيانات آمن

نفّذ Laravel Sanctum first-party SPA session مع CSRF، ثم نظام أدوار وصلاحيات واضح لـ Super Admin, Organization Admin, Data Manager, Analyst, Hub Manager, Viewer, Auditor. كل Route/Policy/Query/Export/File Download يتم فحصه Server-side على organization_id ونطاق مراكز المستخدم. أضف صلاحيات منفصلة: عرض الشحنات، عرض الحقول الحساسة، رفع الملف، اعتماد المابنج، النشر، إعادة المعالجة، الإلغاء، إرجاع نسخة، تنزيل التقرير، إدارة المستخدم، وسجل التدقيق. لا تسمح بإفشاء بيانات شركات أخرى عبر ID أو Query Params. خزن PII وفق سياسات خصوصية وRetention، ولا تعرض أسماء/هواتف/عناوين في logs. جهز اختبارات IDOR وTenant Leakage وRole Boundaries وLogin Rate Limit، وتحقق من Cookies/CORS/SameSite عند الدومينين المتوقعين.

**معايير قبول:** لا يمكن قراءة أو تصدير ملف أو شحنة لشركة أخرى؛ مستخدم Hub يرى نطاقه فقط؛ API المعزول لا يعتمد على إخفاء أزرار React.

---
## المرحلة 03 — Excel Upload, Preview, Mapping, Validation

نفّذ رحلة استيراد ذكية تدعم ملفات Bosta المتغيرة في ترتيب الأعمدة. اقبل رفعًا متعدد الملفات؛ تحقق من الحجم والصيغة الفعلية والضغط الداخلي والتوقيعات، واحفظ الأصل في Private Storage مع SHA-256. ابنِ Workbook Scanner يكتشف sheets/header rows ويعرض Preview مع عينة بيانات مموهة وإخطار بأي أعمدة ناقصة أو غريبة. استخدم القاموس 211/211 لتعيين أي عمود إلى جدوله وحقل MySQL، دون تغيير عنوان المصدر. لا تولد Tracking اصطناعيًا بصمت. احفظ Mapping Profiles قابلة للإصدارات وإعادة الاستخدام، واعرض Date Source وTimezone وDuplicate Policy قبل اعتماد الاستيراد. عالج XLS القديم بمسار متوافق مع نسخة المكتبة المختارة؛ تحقق من قيد Queued XLS في Laravel Excel 3.1، ولا تفترض أن XLS يُعالج بالطريقة نفسها مع XLSX. أنشئ تقرير جودة للصفوف المقبولة والمرفوضة والمكررة والمفقودة، مع إرجاع أخطاء مفهومة.

**معايير قبول:** رفع → Preview → تعديل Mapping → اعتماد؛ عينات متعددة الأوراق؛ كل حقل مصدر لا يضيع؛ لا تحويل تلقائي صامت لتاريخ اليوم عند الفشل.

---
## المرحلة 04 — Staging، المعالجة المتوازية، المعاملات، النشر الذري

ابنِ خط معالجة سريعًا وآمنًا يفصل HTTP عن Jobs. يستخدم Scanner واحدًا لكل ملف لإنشاء Chunks ثابتة صغيرة لها مفاتيح واضحة في التخزين الخاص وDatabase. وزّع Jobs على Redis Queues مستقلة: scans, imports-write, analytics, exports، وراقبها عبر Horizon. ابدأ بعدد Workers محدود قابل للضبط حسب CPU/RAM/MySQL IOPS. استخدم Batch Processing وRetry/Backoff/Deadlock Handling وLock مناسب للتنافس على نفس Run. اجعل Chunk Writer يستخدم Bulk Upsert وShort Transactions مع Idempotency Keys؛ أي Retry لا يضاعف صفوفًا أو Attempts أو Imports. سجّل row-level issues واكتمال الشريحة داخل نفس المعاملة. امنع نشر Run ناقصة أو ملغاة؛ انشر active_run_id دفعة واحدة بعد Quality Gate كاملة وإكمال Projection/visibility contract. حافظ على النسخة السابقة أثناء الاستبدال. عالج Cancel، Crash، Resume، Duplicate Content، ملفات ذات الاسم نفسه بمحتوى مختلف، وتحديث Mapping. تقدم الواجهة يعكس rows/chunks الحقيقية وليس مجرد عدد Jobs.

**معايير قبول:** معالجة 10K/100K وتدريجيًا 1M بذاكرة مستقرة، لا صفوف مزدوجة مع 3 محاولات Retry، لا ظهور لبيانات جزئية أثناء النشر، ولا تعطل طلبات Dashboard أثناء import كبير.

---
## المرحلة 05 — Analytics API، المعادلات، الفهارس والتحسين الفعلي

انقل دوال `filterShipments` و`computeAggregations` بالكامل إلى Laravel Services/Queries، لكن أولًا ثبّت معانيها بواسطة Golden Dataset. أنشئ endpoints versioned للـOverview, Hubs, Businesses, Geography, Timeline, Delivery Attempts, SLA, Filter Facets, Shipment Detail. Dashboard يعرض unique shipments وreport observations بشكل مستقل، مع فترات مقارنة صحيحة، تقرير Data-As-Of، وبيان مراكز معرّفة/نشطة. نفس معايير الفلترة تنطبق على جميع Sections، ويُضمّن tenant + permission scope في كل Cache Key. استخدم Query Builder وDatabase Aggregations بدل Eloquent Hydration لآلاف السجلات. صمم Reporting Facts Projection عند ثبوت الحاجة إليه، مع تحديث/إبطال عند نشر ملف أو إرجاع نسخة. راجع فهارس MySQL بمقارنة EXPLAIN ANALYZE على بيانات ممثلة وقياس Rows Examined/Latency/Lock Waits، ولا تكتف بزيادة الفهارس.

**معايير قبول:** KPI tests تطابق أرقام Golden Dataset، فلاتر + Drill-down متسقة، API لا يجلب 211 عمودًا لمؤشر تجميعي، ولا يقرأ إلا النسخ المنشورة.

---
## المرحلة 06 — إعادة هندسة React Frontend وتجربة استخدام عالمية

احتفظ بـReact/Vite/TypeScript الحالية وبالوظائف والتحليلات الموجودة، لكن فكّك `App.tsx` إلى Router وLayout وProviders وFeature Modules. أنشئ صفحات: Overview، Shipments، Imports، Import Quality، Hubs، Businesses، Geography، Attempts، SLA، Exports، Settings، Users/Roles، Audit. استخدم TanStack Query للـServer State وربط Cache Keys بالمؤسسة/الفترة/الإصدار/نوع المقياس؛ وحّد URL filters على كل الصفحات، Server-side Pagination/Sort/Search وDrill-down. ابنِ Import Wizard من 7 خطوات مع Progress، حالات Loading/Error/Partial Success ومراجعة ملفات واضحة. حافظ على خصائص الرسوم والتصدير والفلترة الأصلية ثم حسّنها. طبّق Design System أنيقًا بوضعي Dark/Light، وResponsive Desktop/Tablet/Mobile وRTL اختياري، مع تسميات واضحة وخطوط مناسبة ومخططات لا تتزاحم. لا تستخرج قائمة مليون سجل إلى React ولا تحسب KPI الرسمية على المتصفح. لا تعرض 0 عندما يفشل API أو لم تكتمل البيانات. أضف API Error Handling وPermission-aware Navigation وعمليات Export آمنة.

**معايير قبول:** E2E: login → overview → filter → shipment detail → upload → preview → publish → report؛ ينجح على شاشة هاتف وتابلت وكمبيوتر؛ كل الإحصائيات تأتي من API المصدر الرسمي.

---
## المرحلة 07 — التقارير والإدارة ومراجعة البيانات

نفّذ نظام Export Request غير متزامن يدعم Excel/CSV/PDF حسب المتطلبات، ويعيد حالة الطلب وتاريخ انتهاء رابط التنزيل. لا تجعل تنزيل مليون صف يحدث داخل Request عادي أو Browser. عالج CSV Formula Injection وعمليات البيانات الحساسة، وتحقق من الصفوف الناتجة بنفس Filters وScope وصلاحيات صاحب الطلب. أضف Import History وFile Versions وReprocess وRollback وMapping Management وAudit Events وتقرير جودة شامل، مع حماية من الحذف غير المقصود وخيار Soft-Delete/Retention حسب السياسة. اجعل مسؤول النظام يرى حالات Queue وفشل Jobs ومقاييس الأداء، دون كشف محتوى PII.

**معايير قبول:** تقارير تعكس بيانات النسخة الفعالة، لا تصدير غير مصرح به، روابط التنزيل تنتهي، وإعادة المعالجة لا تغير الأرقام حتى تتم عملية Publish صحيحة.

---
## المرحلة 08 — الاختبارات، الأداء، الأمن، الإنتاج

نفذ اختبارات Pest/PHPUnit وVitest وPlaywright أو بدائل متوافقة؛ كوّن بيانات Fixture مطابقة لتنوع 211 عمودًا، بما فيها 9 مجموعات Attempts ومعلومات عربية وصيغ تاريخ مختلفة. جرّب أحجام 10K/100K/1M على بيئة مواصفاتها معروفة، وقِس Import Throughput، Queue Latency، Memory، DB Locks، API P50/P95/P99 تحت 1/5/10 مستخدمين مع استيراد متزامن. نفذ اختبارات Browser Refresh وOffline Error وTimeout، وIDOR، وPII، وExcel/CSV Injection، وإفساد ملف، وRestart Worker، وRestore Backup. جهز CI/CD مع Staging وMigrations مرجعية وQueue Supervision وLogs وMetrics وRollback للنسخة الحالية. أخرج تقريرًا يميز PASS/FAIL/NOT RUN لكل فحص مع الأرقام والمعلومات الناقصة. لا تدعي زمن استجابة أو معدل معالجة لم يتم قياسه.

**معايير قبول:** Quality Gate مكتوبة وقابلة للتكرار، تشغيل مشروع جديد من الصفر، لا بيانات مفقودة، تقارير صحيحة، نسخة Backup تم اختبار إرجاعها، وخطة إطلاق Production مع rollback.

---
## قالب تقرير موحد يجب أن يرسله Codex بعد كل مرحلة

1. **ما الذي نُفذ؟** قائمة محددة بالوظائف والكائنات/الجداول/الواجهات.
2. **ما الذي تغيّر؟** أسماء المسارات والملفات دون نسخ أكواد في الرسالة.
3. **ما الذي تم اختباره؟** اسم الاختبار ونتيجته مع تمييز Not Run.
4. **هل تغير تعريف أي KPI أو نوع حقل؟** سبب وتحليل أثر وتوافق خلفي.
5. **هل هناك مَخاطر؟** بيانات أو أداء أو أمان أو احتياجات بيئة.
6. **كيف نرجع للخلف؟** وصف Rollback لكل Migration/Job/واجهة.
7. **ما شروط الانتقال للمرحلة التالية؟** قائمة واضحة مع PASS/FAIL.
