# Bosta Analysis — المرجع التنفيذي الكامل (بدون أكواد)

**المصدر:** مستودع `osamaabdelmordy77/bosta-analysis` على الفرع `main`، وملف Excel النموذجي ذي 211 عنوان عمود.  
**هدف الوثيقة:** وصف سلوك النظام، مخطط قاعدة بيانات Laravel + MySQL، مسارات المعالجة المتوازية، العقود الوظيفية للـAPI، خطة React، الفهارس، الاختبارات، وشروط التسليم.  
**تنبيه:** هذه مواصفات تنفيذ مقترحة؛ جرى فحص رؤوس الأعمدة وعينة صف واحدة فقط، وليس تنميط ملفات إنتاج متعددة أو تنفيذ Benchmarks. أسماء الحقول وأنواعها تحتاج اختبارًا على ملفات حقيقية قبل التثبيت النهائي.

## 1. المبادئ التي لا تُساوم

1. لا حذف لأي من حقول المصدر الـ211، ولا اختزال بيانات الشحنة الخام في JSON كبديل للأعمدة المهيكلة. يجوز استخدام JSON للمابنج والإعدادات التشخيصية فقط.
2. لا يُسمح للواجهة بتحديد المعادلات الرسمية أو إجراء تجميع على جميع الصفوف من المتصفح؛ Laravel هو المصدر المعتمد للحقائق والمؤشرات.
3. التمييز بين **هوية الشحنة** (`shipments`) و**ظهورها في تقرير/نسخة معينة** (`shipment_snapshots`). تعريف العدّ يجب أن يكون ظاهرًا: Unique Shipments مقابل Daily/Report Observations.
4. الاحتفاظ بالملف الأصلي على تخزين خاص، وبتاريخ التقرير ومصدره وبصمة المحتوى ورقم الورقة والصف وتاريخ الاستيراد.
5. الاستيراد المتوازي لا يكشف بيانات جزئية؛ تُنشر نسخة تقرير جديدة في عملية قصيرة ذرّية فقط بعد اكتمال المعالجة والتدقيق، وتظل النسخة السابقة متاحة حتى ذلك الوقت.
6. كل استعلام وعملية مرتبطة بمؤسسة وصلاحيات، ويُفحص التفويض في السيرفر لا عبر إخفاء عناصر React.
7. لا تُقاس الجودة بعدد Workers ولا بعدد Indexes؛ تُقاس بصحة الأرقام، ومعدلات المعالجة، وذاكرة العامل، وزمن الاستجابة أثناء ضغط الاستيراد.

## 2. جرد المصدر وطبيعة الأعمدة

- **211 عنوانًا فريدًا** في النموذج: 139 حقلًا منفردًا و72 حقل محاولة (9 مجموعات × 8).
- حقول المحاولات: مجموعة غير مرقمة `Attempt` ومجموعات `Attempt 1` حتى `Attempt 8`. تحفظ في جدول `delivery_attempts` كمجموعة من 8 أعمدة مهيكلة لكل محاولة مع `attempt_group` من 0 إلى 8. لا نستنتج أن المجموعة 0 تساوي أحدث محاولة دون إثبات.
- التصنيفات المبدئية: 49 حقلًا للـSnapshot، 22 للأطراف والعناوين، 22 للمسارات، 24 للجانب المالي، 22 للخدمة والجودة، و72 للمحاولات.
- حقول الهوية وأرقام التتبع والهواتف والأكواد تحفظ كنصوص للحفاظ على الأصفار البادئة والطول وعدم السماح بتقريب Excel الرقمي. المال DECIMAL، الأحداث الزمنية DATETIME بعد تحديد المنطقة الزمنية، والأعلام Boolean/Tinyint حسب القيم الحقيقية.
- `Expected Delivery Date` و`SLA Date` و`Delivery SLA Date` و`Received Time` ليست بالضرورة ذات المعنى أو المنطقة الزمنية؛ تُوثق كل حالة.
- قبل اعتماد الأنواع، نفذ Profiling لقيم غير فارغة من عدة ملفات: أكبر طول نص، صيغة تاريخ، نسب Null، قيم N/A، القيم الرقمية الشاذة، حالات TRUE/FALSE/Yes/No.

## 3. مخطط الجداول والعلاقات

### أ. الحسابات والصلاحيات

| الجدول | المسؤولية | قواعد أساسية |
|---|---|---|
| `organizations` | المؤسسة ونطاق العزل والإعدادات الزمنية | معرف ثابت، اسم، slug فريد، timezone |
| `users` | المستخدم والحساب | اسم، بريد، حالة، بيانات مصادقة |
| `organization_user` | عضوية المستخدم في مؤسسة | Unique للمؤسسة والمستخدم، حالة العضوية |
| `roles / permissions` | RBAC | إدارة صلاحيات منفصلة عن الحالة المرئية |
| `user_hub_access` | نطاق المراكز المسموح بعرضها | Unique لكل مستخدم/مؤسسة/مركز |
| `audit_logs` | من فعل ماذا ومتى وعلى أي نسخة | بيانات التدقيق لا تُحذف مع ملف دون سياسة |

### ب. المستندات والإصدارات

| الجدول | المسؤولية | قواعد أساسية |
|---|---|---|
| `import_files` | الهوية الثابتة للملف وملفه الخام | `organization_id`, original_name, SHA-256, private_path, `active_run_id` |
| `import_runs` | نسخة معالجة مستقلة لملف | revision, mapping_version, duplicate_policy, report_date, status, counters |
| `import_sheets` | أسماء الأوراق والصفوف والعناوين | source_sheet_index, header_row, detected_columns |
| `import_chunks` | قسم عمل مستقل للمعالجة | Unique (run, sheet, chunk), state, retries, row range |
| `import_issues` | تفاصيل رفض أو تصحيح صف | source sheet/row/column, issue code, severity, safe sample |
| `column_mappings` | قوالب المابنج وإصداراتها | صيغ أسماء الأعمدة ونوع التقرير وتاريخ السريان |
| `report_exports` | تقارير التصدير الخلفية | status, filter snapshot, private path, expires_at |

### ج. الشحنات والوقائع

| الجدول | المسؤولية | الأعمدة الخاصة بالمصدر |
|---|---|---:|
| `shipments` | هوية Tracking داخل نطاق المؤسسة؛ لا تكرر نتيجة إعادة الاستيراد | مفاتيح وإشارات بيانات مرجعية |
| `shipment_snapshots` | واقعة السجل في تقرير محدد، حالة الشحنة، التواريخ الأساسية، نوع الطرد | 49 |
| `shipment_snapshot_parties` | المستلم، الهواتف، العناوين، Star، مناطق الاستلام والتسليم | 22 |
| `shipment_snapshot_routing` | مراكز التعيين والحركة والممرات والأكواد | 22 |
| `shipment_snapshot_financials` | COD، الضرائب، الرسوم، التسويات، العلامة التجارية | 24 |
| `shipment_snapshot_service` | الاتصالات والرسائل والاستثناءات والشكاوى والتقييمات | 22 |
| `delivery_attempts` | سجل مستقل لكل مجموعة محاولة بثمانية حقول | 72 عنوانًا → 9 سجلات × 8 حقول |
| `businesses` | معجم التجار المعتمد | اسم معياري ورمز خارجي ونطاق الشركة |
| `hubs`, `hub_aliases` | هوية مركز موحدة مع حفظ أسماء المصدر | أكواد وأسماء بديلة مرتبطة بمؤسسة |
| `locations` | مدن ومناطق وقطاعات موحدة | لا تفقد النص الأصلي |

### د. الفروق بين الجداول الرئيسية

- `shipments`: Unique (`organization_id`, `tracking_number`) **بعد** تثبيت نطاق تفرد رقم التتبع؛ لو كان يتكرر بين حسابات مختلفة ينبغي إضافة نطاق Business أو Carrier قبل فرض القيد.
- `shipment_snapshots`: Foreign Key إلى `shipment`, `import_file`, `import_run`، مع `report_date`, `sheet_index`, `source_row_number`, timestamps, `organization_id` للفلترة، وقيد Unique (`import_run_id`, `sheet_index`, `source_row_number`) لإعادة المحاولة بدون تكرار.
- `shipment_snapshot_*`: علاقة One-to-One، مفتاح `snapshot_id` فريد، وتبقى حقول المصدر نصية/عددية/زمنية منفصلة حسب القاموس أدناه.
- `delivery_attempts`: `snapshot_id`, `attempt_group`, `attempt_type`, `attempt_by`, `attempt_hub_name`, `attempt_at`, `exception_fake_attempt`, `exception_reason`, `exception_at`, `exception_coordinates`. قيد Unique على (`snapshot_id`, `attempt_group`). احتفظ بالنص الجغرافي الأصلي، واشتق إحداثيات منفصلة فقط بعد تحقق من الصيغة.
- `import_files.active_run_id`: النسخة الوحيدة المنشورة للتقارير العادية؛ تظل الإصدارات السابقة محفوظة للتدقيق أو التراجع وفق سياسة الاحتفاظ. يجب اتساق `active_run_id` مع نفس الملف والمؤسسة عند الحفظ.

## 4. استراتيجية الفهارس والفصل بين OLTP والتحليلات

المبدأ: فهرس مركب صغير يخدم نمط قراءة معروف أفضل من فهرسة كل الأعمدة. تحقق من فائدة Leftmost Prefix باستخدام EXPLAIN ANALYZE قبل اعتماد أي فهرس إضافي.

| الجدول | الفهرس أو القيد المبدئي | لماذا؟ | درجة الأولوية |
|---|---|---|---|
| `shipments` | Unique (`organization_id`, `tracking_number`) | إيجاد شحنة وعدم تكوين Master مكرر | ضروري بعد اعتماد التفرد |
| `shipment_snapshots` | Unique (`import_run_id`,`sheet_index`,`source_row_number`) | Idempotency حتى مع Retry | ضروري |
| `shipment_snapshots` | (`organization_id`,`report_date`,`shipment_id`) | مدى زمني ومؤشرات وفريدة | ضروري |
| `shipment_snapshots` | (`organization_id`,`shipment_id`,`report_date`) | Timeline للشحنة | ضروري |
| `shipment_snapshots` | (`organization_id`,`delivery_state`,`report_date`) | التقارير التشغيلية والحالات | مرشح عالي |
| `shipment_snapshots` | (`organization_id`,`business_external_id`,`report_date`) | تحليلات التاجر | مرشح عالي |
| `shipment_snapshots` | (`import_file_id`,`import_run_id`) | قصر النتائج على النسخة النشطة | ضروري |
| `import_chunks` | Unique (`import_run_id`,`sheet_index`,`chunk_index`) | منع الازدواج في المعالجة | ضروري |
| `import_files` | (`organization_id`,`sha256`) | كشف ملف له نفس المحتوى؛ **ليس** قيد Unique تلقائيًا | ضروري |
| `delivery_attempts` | Unique (`snapshot_id`,`attempt_group`) | منع تكرار محاولة عند Retry | ضروري |
| `delivery_attempts` | (`attempt_hub_name`,`attempt_at`) | ترتيب وتحليل المحاولات | حسب الاستعلامات |
| `shipment_snapshot_routing` | (`assigned_hub_name`) و(`current_hub_name`) | قراءة حسب المركز | أولي؛ قد يحتاج Projection |
| `shipment_snapshot_parties` | (`pickup_city`) و(`dropoff_city`) | الفلاتر الجغرافية | أولي؛ راجع جدواها |
| `audit_logs` | (`organization_id`,`created_at`) | مراجعة الأنشطة ضمن شركة | ضروري |

**ملاحظة أداء مهمة:** الفهارس على جداول التفاصيل وحدها لا تكفي دائمًا لاستعلام يجمع الشركة والتاريخ والمركز عبر JOIN؛ لو كانت تحليلات المراكز أو التجار تتطلب زمنًا منخفضًا عند ملايين السجلات، أنشئ `shipment_report_facts` بوصفه **جدول Projection مهيكلًا** يحوي مفاتيح المؤسسة، وتاريخ التقرير، والشحنة، والتاجر، والمراكز، والحالة، والعناصر، وإصدار الملف المنشور. اختبر فهارس (`organization_id`,`assigned_hub_id`,`report_date`) و(`organization_id`,`business_id`,`report_date`) عمليًا. حافظ على اتساقه مع نشر وتراجع النسخ عبر عملية محددة قابلة للاستعادة.

## 5. رحلة Excel الصحيحة من أول رفع إلى لوحة التقارير

1. **اختيار ملف:** تحقق من الصلاحية والصيغة والامتداد وMagic Bytes والحجم وقوة الملفات المضغوطة ضد ZIP Bombs. لا ترسل أسماء أو بيانات حساسة إلى logs.
2. **قبول سريع:** الطلب يتوقف بعد حفظ الخام داخل Private Storage وإنشاء سجل إدخال؛ لا ينفذ تحليل مليون صف داخل طلب HTTP.
3. **كشف بنية المصنف:** Scanner واحد لكل ملف يحدد الأوراق وصف العنوان وأسماء الـ211 المحتملة، ويكشف تغيّر مخطط Bosta بين ملفات مختلفة.
4. **Preview:** يظهر عمود المصدر، العمود المستهدف، النوع المقترح، عينة مع إخفاء PII، تاريخ الملف، الفروق، وأخطاء الأعمدة الأساسية.
5. **اعتماد Mapping/Policy:** مستخدم مفوض يختار تاريخ التقرير وقواعد تكرار Tracking والتعامل مع الأوراق/الصفوف غير الصالحة؛ ثم يحفظ نسخة Mapping ذات رقم إصدار.
6. **Staging:** تجهيز شرائح ثابتة من 500–1000 صف كنقطة انطلاق قابلة للقياس، لكل شريحة معرف لا يتكرر. تجنب أن يفتح كل Worker ملف XLSX كاملًا مستقلًا.
7. **Queued parallel jobs:** صف `imports-parse` للاستعراض والتحضير، `imports-write` للكتابة، `analytics` للتلخيص، `exports` للتصدير؛ عزل الحمل حتى لا يحجب التقارير.
8. **Writer:** يتحقق من النوع والقيم ويحفظ عبر Bulk Upserts ومعاملات قصيرة للقطعة. عندما يفشل Worker أو يعاد تشغيله لا تتكرر الصفوف بسبب مفاتيح المصدر وحالة Chunk الملتزمة داخل Transaction.
9. **Quality Gate:** تجميع المقبول والمرفوض والمكرر، التحقق من حفظ كل الـChunks، ومرجع Mapping والإصدار وتغطية الأعمدة وأي قيود تحتاج موافقة.
10. **Publish ذرّي:** تحويل `active_run_id` في عملية قاعدة بيانات قصيرة بعد النجاح؛ لا يرى مستخدم Dashboard أي Snapshot غير منشور.
11. **تحديث التحليلات:** إبطال الكاش الخاص بالمؤسسة والنسخة ونطاق الفلاتر، وتحديث Projection وتخزين الملخصات إن وجدت؛ لا تعرض نجاحًا قبل اكتمال رؤية البيانات.
12. **التراجع والإصلاح:** Reprocess/Replace ينشئ Import Run جديدًا، والأقدم يبقى صالحًا حتى النجاح؛ Undo يعيد تعيين النسخة السابقة مع نفس بروتوكول تحديث Projection.

### ماذا يحدث عند اختلاف تقريرين لنفس Tracking؟

- يحتفظ `shipments` بهوية مشتركة، لكن كل ظهور مصدره (`file`,`run`,`sheet`,`row`,`report_date`) داخل `shipment_snapshots`.
- يظل معيار «عدد الشحنات الفريدة» مختلفًا عن «عدد مرات الظهور في التقارير»؛ لا يوجد دمج صامت بين الحالتين.
- لا يصح افتراض أن كل ظهور في يومين يمثل رحلة Hub حقيقية؛ التقرير قد يكون Snapshot للحالة فقط. أضف أحداث الحركة الفعلية عند وجود مصدر موثوق لها.

### تعريفات KPI قبل البرمجة

- `Unique Shipments`: عدد أرقام Tracking الفريدة وفق نطاق المنظمة والسياسة المعتمدة خلال الفلاتر الزمنية.
- `Report Observations`: عدد سجلات التقارير المنشورة التي اجتازت سياسة الجودة، مع توضيح قواعد التكرار داخل الملف.
- `Total Items`: مجموع العناصر وفق مقياس التقرير المعتمد؛ لا تخلطه مع قيمة الأصناف الفريدة دون تصريح.
- `Active Hubs`: المراكز التي لها حجم ضمن أساس Hub المختار والفترة؛ `Known Hubs` معجم أوسع مستقل.
- `On-time/SLA`: لا يمكن احتسابه بدقة إلا بعد تثبيت قواعد المنطقة الزمنية وتاريخ SLA ووقت التسليم والنواقص وحالات الإرجاع.
- `MoM`: المقارنة بين الشهر التقويمي السابق لا السابق *الموجود* في البيانات، مع سياسة شهر لا توجد له بيانات.
- كل KPI يعرض Data-As-Of، والنطاق، والمرشح، ونوع العد، وتفسير النسبة وحالة البيانات المفقودة.

## 6. هندسة Laravel والمصادقة

- Backend واحد منظم Modular Monolith: Modules منطقية Auth, Organizations, Imports, Shipments, Analytics, Reports, Settings, Audit.
- Controllers رقيقة؛ Form Requests للتحقق؛ Services/Actions لقواعد العمل؛ Repositories فقط عند وجود حاجة حقيقية، لا فرض طبقة شكلية؛ Jobs للتشغيل الخلفي؛ Policies لتفويض الملفات والتقارير والشحنات.
- Models وعلاقاتها: Organization -> Users/ImportFiles/Shipments؛ ImportFile -> ImportRuns؛ ImportRun -> Chunks/Snapshots؛ Shipment -> Snapshots؛ Snapshot -> Parties/Routing/Financials/Service/Attempts. قيود DB مكملة لـ Validation.
- Sanctum للـSPA باستخدام Cookie Session وCSRF عند استخدام نفس الجذر الدوميني؛ CORS وSameSite مضبوطين؛ لا تخزين لتوكن دائم في localStorage. راجع نسخة Laravel وحزم التشغيل فعلًا قبل اختيار الإصدارات.
- Roles: Super Admin, Organization Admin, Data Manager, Analyst, Hub Manager, Viewer, Auditor. صلاحيات دقيقة view/import/approve/reprocess/delete/export/read-sensitive/manage-mapping/manage-users/manage-settings.
- الحقول الحساسة: الاسم والهاتف والعنوان والملاحظات والشكاوى ومعلومات الدفع؛ طبّق Masking وفق الدور، وتقنين الاحتفاظ، والتشفير المناسب في السكون ووقت النقل، مع عدم إفشاء هذه القيم في الاستثناءات.

## 7. API Contract — وظائف وليس أكوادًا

| الطريقة والمسار | ماذا يفعل؟ | ضمانات |
|---|---|---|
| Login / Logout / Me | المصادقة وجلسة المستخدم | CSRF وThrottling وOrg Access |
| POST imports | حفظ ملف واستلام Import ID | استجابة سريعة + Private Storage |
| GET imports/:id/preview | معاينة الأعمدة والتواريخ والملاحظات | حقول حساسة مموهة |
| PUT imports/:id/mapping | اعتماد Mapping بإصدار | صلاحية وتاريخ مراجع |
| POST imports/:id/commit | بداية المعالجة الخلفية | Idempotency Key |
| GET import-runs/:id | الحالة والتقدم والأخطاء | Org-scope وCounts حقيقية |
| POST import-runs/:id/cancel | إلغاء آمن | لا نشر عند الإلغاء |
| POST imports/:id/reprocess | نسخة مستقلة جديدة | لا مساس بالمنشور |
| GET imports | الملفات، النسخ، الملخصات | Paging + Permissions |
| GET shipments | بحث وتصفية وفرز وصفحات | All filters server-side |
| GET shipments/:id | التفاصيل والتاريخ والمحاولات | PII Authorization |
| GET dashboard/overview | مؤشرات مجمعة | Versioned Metric Definitions |
| GET analytics/hubs | ترتيب وقنوات المراكز | Hub Basis واضح |
| GET analytics/businesses | التجار ومقارنة الأداء | Merchant Identity واضحة |
| GET analytics/geography | توزيع الأماكن والمسارات | Canonical + Raw Names |
| GET analytics/time | يومي/شهري/SLA | Calendrical gaps واضحة |
| GET analytics/attempts | المحاولات والاستثناءات | Attempt Groups بلا افتراض |
| GET filters/options | اختيارات وتصنيفات البحث | Facets مهيكلة ومحدودة |
| POST exports وGET exports/:id | توليد تقرير ثم تسلمه | ملف خاص + وصول مؤقت |
| GET/PUT settings/mappings | إدارة نسخ Mapping | Audit وVersioning |
| GET audit-logs | عمليات المستخدمين | Auditor/Admin فقط |

**قواعد API العامة:** `api/v1`، Validation Errors معيارية، Pagination metadata، Request ID وTrace ID، منع الحقول الحساسة افتراضيًا، رفض Sort Field غير مسموح، عدم استخدام `SELECT *` في المؤشرات، ETag أو Version Key عند جدواها. لا يرجع Dashboard الـ211 عمودًا في كل طلب.

## 8. Frontend React — المرجع الوظيفي والبصري

- احتفظ بمكونات React الحالية كنقطة مقارنة؛ افصل App الحالية إلى Router + Layout + Providers + Feature Pages، وألغِ الحسابات الرسمية المكررة في المتصفح.
- صفحات: Overview، Shipments Explorer، Import Center، Import Details/Quality، Hubs، Businesses، Geography، Delivery Attempts، SLA Operations، Reports/Exports، Settings/Mappings، Users/Roles، Audit Log.
- واجهة احترافية خفيفة وسريعة، Responsive حقيقي للكمبيوتر والتابلت والموبايل، Dark/Light مع تصميم Tokens، عربي/إنجليزي حسب المتطلبات الفعلية، RTL عند تفعيل العربية.
- TanStack Query لبيانات API، Query Keys تشمل organization, active_dataset_version, filters, hub basis, metric؛ عند تغيير النسخة المنشورة تبطل النتائج المتأثرة فقط.
- Filter Bar واحد عبر URL parameters، يضم السنوات والأشهر والمدى والتاجر والمركز والمدن والأنواع والحالات؛ البحث Debounce مع خيار Clear وPresets؛ كل الرسميات تدعم Drill-down بنفس الفلاتر.
- Explorer: Server Pagination, Sorting, Search, Detail Drawer، Timeline، Source Provenance؛ لا تحميل شامل لمليون سجل ولا Export كثيف في Browser.
- Import Wizard: Upload → Preview → Map Columns → Review Date/Duplicate Policy → Commit → Live Progress → Quality Report؛ عرض التقدم بناءً على أرقام فعلية؛ فشل ملف لا يمحو نتائج ملفات أخرى.
- الحالة المرئية: Loading/Skeleton, Empty, Error/Retry, Success, Partial Quality Warning, Stale Data Indicator؛ **لا تعرض 0 عند فشل API**.
- Grid dashboards: KPIs، اتجاهات زمنية، مراكز، تجار، مدن، استثناءات، SLA، مقارنة فترة؛ لا تستخدم رسومًا ضخمة تستقبل آلاف النقاط دون ترشيح أو تلخيص.
- Accessibility: لوحة المفاتيح، focus visible، Label لكل عنصر، Contrast، عدم جعل الصفوف القابلة للنقر غير قابلة للاستخدام بلوحة المفاتيح.

## 9. ميزانية الأداء والمراقبة

- أحمال اختبار: 10K / 100K / 1M صف، مع ملف واحد وعدة ملفات متزامنة، عبر جهاز Server محدد وتوثيق RAM/CPU/IOPS.
- عينات Chunk أولية: 500 أو 1000 صف؛ يختار النظام العدد بناءً على Benchmark، لا على حدس.
- Worker Pools أولية: Preview/Scan منفصل، Imports 2–4 عمال مبدئيًا، Analytics 1–2، Exports 1. ابدأ بالقليل وزد حتى نقطة الذروة قبل حدوث Lock Contention أو Saturation.
- راقب Import Rows/sec, Queue Wait, Worker RSS, DB Locks/Deadlocks, Disk IOPS, API P50/P95/P99, Error Rate, Cache Hit Ratio, Reconciliation Errors.
- Gate: يجب ألا يتسبب الضغط في تحميل جميع السجلات داخل React، ويجب ألا يفسد إعادة الاستيراد الأرقام، ويجب ألا يرى مستخدم Snapshot نصف منشور. ضع أهدافًا زمنية بعد قياس Baseline وليس وعودًا ثابتة.
- Redis مع Horizon وسير عمل Supervisor في VPS؛ إن كانت البيئة Shared Hosting لا تسمح بعمليات مستمرة، صرّح بعدم ملاءمتها لمسار المعالجة المتوازية الكثيف.

## 10. خطة الاختبار والأمان

**Unit:** تعيين جميع الأعمدة 211؛ تطبيع العناوين؛ Tracking كنص؛ تاريخ وزمن وصيغة غير صالحة؛ رقم مال كبير وNull؛ أي مجموعة Attempt؛ قواعد التكرار وSLA وMoM.

**Integration:** جدولة Jobs بعد Commit، معالجة ملف متعدد الأوراق، Resume/Retry وDeadlock، فشل Chunk، ملفات معاد تسميتها، نفس الاسم ومحتوى مختلف، إلغاء منتصف المعالجة، نشر ذرّي، Rollback، فصل المراكز والشركات، توليد تقرير صلاحياته صحيحة.

**Performance:** Benchmark قابل لإعادة التشغيل مع CSV وXLSX، أحجام 10K/100K/1M، عدة عمليات موازية؛ مقارنة مؤشرات Frontend وBackend القديمة ببيانات مرجعية قبل التحويل.

**Security:** Row-Level tenant scope، IDOR، حقن SQL، CSV Formula Injection، ZIP Bomb، خطر الملفات المؤقتة، تسرب PII في logs/exports، صلاحيات التنزيل، Rate Limit، Session/CSRF، Backup Encryption وRestore Drill.

**Release Gates:** Migrations من قاعدة نظيفة، تحقق جميع النماذج والعلاقات، Tests Pass، Lint/Typecheck/Build، تدقيق الحزم، اختبار استعادة نسخة احتياطية، مراجعة الحقوق، إثبات أن آخر نسخة منشورة فقط ظاهرة، سجل تغييرات وRollback Plan لكل مرحلة.

## 11. ترتيب التنفيذ

| الترتيب | المرحلة | الناتج المطلوب قبل التي تليها |
|---|---|---|
| 0 | Source Audit + Business Rules | Definition Sheet وData Profiling وGolden Samples |
| 1 | Schema + Migrations + Models | علاقات وفهارس و211/211 Coverage Test |
| 2 | Auth + Tenant Policies | Access Tests وSensitive Field Masking |
| 3 | Excel Preview + Mapping | تسجيل ملف ومعاينة وآلية اعتماد |
| 4 | Queues + Staging + Atomic Publish | Parallel + Idempotent + Error Reporting |
| 5 | API Analytics + KPI Contracts | Golden Metrics + Validated Query Plans |
| 6 | React Feature Refactor | صفحات مكتملة ووحدة فلترة وربط فعلي |
| 7 | Reports + Admin + Audit | Exports محمية وعمليات إدارة سليمة |
| 8 | Load/Security Tests + Deployment | Benchmarks وBackup/Restore وRelease Readiness |

## 12. مراجع رسمية

- Laravel Queues, Batching, Transactions: https://laravel.com/framework/docs/13.x/queues
- Laravel Horizon / Supervisor / Balancing: https://laravel.com/framework/docs/13.x/horizon
- Laravel Sanctum SPA sessions: https://laravel.com/framework/docs/13.x/sanctum
- Laravel Authorization / Policies: https://laravel.com/framework/docs/13.x/authorization
- Laravel Migrations & Eloquent: https://laravel.com/framework/docs/13.x/migrations ; https://laravel.com/framework/docs/13.x/eloquent
- MySQL 8.4 Indexes: https://dev.mysql.com/doc/refman/8.4/en/optimization-indexes.html
- MySQL EXPLAIN: https://dev.mysql.com/doc/refman/8.4/en/using-explain.html
- Laravel Excel Chunk Reading (3.1): https://docs.laravel-excel.com/3.1/imports/chunk-reading.html
- Laravel Excel Queued Reading (3.1): https://docs.laravel-excel.com/3.1/imports/queued.html
- Laravel Excel Queued Reading (4.x): https://docs.laravel-excel.com/4.x/imports/queued.html
- TanStack React Query Pagination: https://tanstack.com/query/latest/docs/framework/react/guides/paginated-queries
- OWASP CSV Injection: https://community.owasp.org/attacks/CSV_Injection
- Spatie Laravel Permission: https://spatie.be/docs/laravel-permission/v8/basic-usage/basic-usage

**تنبيه إصدار:** ابحث عن Compatibility Matrix الفعلية قبل اختيار إصدار Laravel Excel/Spatie؛ لا تفترض توافق إصدار Laravel مع الحزمة دون Composer verification. Laravel Excel 3.1 ينبه إلى عدم Queue المباشر لصيغة `xls`؛ وفر مسار تحويل آمن إلى `xlsx` ثم جدولة أو معالجًا مناسبًا في سياق معزول.

## 13. القاموس الكامل للأعمدة (211/211) — المصدر ← جدول MySQL ← حقل فيزيائي ← نوع أولي

كل الأسطر التالية **خرائط تنفيذ** وليست شيفرة. احتفظ بعنوان المصدر حرفيًا، ولا تستنتج من صف المثال أن جميع القيم تتبع النوع المقترح بلا اختبار.

### shipment_snapshots — 49 عنوانًا

| # | اسم عمود المصدر | العمود المقترح | نوع البيانات المبدئي | المجموعة |
|---:|---|---|---|---|
| 1 | Business | `business_name` | string(191) | — |
| 2 | Business ID | `business_external_id` | string(100) | — |
| 3 | Tracking Number | `tracking_number` | string(100) | — |
| 4 | Package Size | `package_size` | string(191) | — |
| 5 | Created At | `source_created_at` | dateTime | — |
| 6 | Picked-Up Date | `picked_up_at` | dateTime | — |
| 7 | Picked From Customer Date | `picked_from_customer_at` | dateTime | — |
| 8 | Expected Pickup Date | `expected_pickup_date` | dateTime | — |
| 9 | Expected Delivery Date | `expected_delivery_date` | dateTime | — |
| 10 | Expected Return Date | `expected_return_date` | dateTime | — |
| 11 | Pickup Request Id | `pickup_request_id` | string(100) | — |
| 30 | Merchant name | `merchant_name` | string(191) | — |
| 31 | Notes | `notes` | text | — |
| 32 | Type | `shipment_type` | string(191) | — |
| 33 | Business Reference Number | `business_reference_number` | string(100) | — |
| 34 | Business Delivery Promise | `business_delivery_promise` | string(191) | — |
| 35 | Delivered at | `delivered_at` | dateTime | — |
| 36 | Delivery State | `delivery_state` | string(191) | — |
| 37 | Updated at | `source_updated_at` | dateTime | — |
| 41 | Number Of attempts | `attempts_count` | unsignedInteger | — |
| 42 | Forward Attempts Count | `forward_attempts_count` | unsignedInteger | — |
| 43 | Return Attempts Count | `return_attempts_count` | unsignedInteger | — |
| 50 | First Attempt Date | `first_attempt_at` | dateTime | — |
| 52 | SLA Date | `sla_at` | dateTime | — |
| 53 | Exceeded SLA | `exceeded_sla` | boolean | — |
| 54 | Exceeded Delivery SLA | `exceeded_delivery_sla` | boolean | — |
| 55 | Delivery SLA Date | `delivery_sla_at` | dateTime | — |
| 56 | Investigation At | `investigation_at` | dateTime | — |
| 57 | Scheduled At | `scheduled_at` | dateTime | — |
| 58 | Lost At | `lost_at` | dateTime | — |
| 61 | Damaged At | `damaged_at` | dateTime | — |
| 63 | Is OnHold | `is_on_hold` | boolean | — |
| 64 | OnHoldDate | `on_hold_at` | dateTime | — |
| 69 | RTO Time | `rto_at` | dateTime | — |
| 82 | Package type | `package_type` | string(191) | — |
| 83 | Description | `description` | text | — |
| 84 | Items | `items` | unsignedInteger | — |
| 85 | Actual Weight | `actual_weight` | decimal(14,3) | — |
| 86 | Volumetric Weight | `volumetric_weight` | decimal(14,3) | — |
| 89 | Is Confirmed Delivery | `is_confirmed_delivery` | boolean | — |
| 90 | Confirmed Delivery At | `confirmed_delivery_at` | dateTime | — |
| 91 | Is Auto Delivered | `is_auto_delivered` | boolean | — |
| 92 | Old Type | `old_type` | string(191) | — |
| 93 | FXF SO Number | `fxf_so_number` | string(191) | — |
| 99 | Payment Type | `payment_type` | string(191) | — |
| 104 | Business Request date | `business_request_at` | dateTime | — |
| 106 | International Tracking Number | `international_tracking_number` | string(100) | — |
| 107 | Multi-package | `multi_package` | string(191) | — |
| 211 | Auto Delivered By | `auto_delivered_by` | string(191) | — |

### shipment_snapshot_parties — 22 عنوانًا

| # | اسم عمود المصدر | العمود المقترح | نوع البيانات المبدئي | المجموعة |
|---:|---|---|---|---|
| 12 | Consignee Name | `consignee_name` | string(191) | — |
| 13 | Consignee phone | `consignee_phone` | string(191) | — |
| 14 | Pickup First Line | `pickup_first_line` | text | — |
| 15 | Pickup Second Line | `pickup_second_line` | text | — |
| 16 | Pickup Zone | `pickup_zone` | string(191) | — |
| 17 | Pickup City | `pickup_city` | string(191) | — |
| 18 | Pickup District | `pickup_district` | string(191) | — |
| 19 | DropOff First Line | `dropoff_first_line` | text | — |
| 20 | DropOff Second Line | `dropoff_second_line` | text | — |
| 21 | DropOff Zone | `dropoff_zone` | string(191) | — |
| 22 | DropOff City | `dropoff_city` | string(191) | — |
| 23 | DropOff District | `dropoff_district` | string(191) | — |
| 24 | Business Return Name | `business_return_name` | string(191) | — |
| 27 | Star name | `star_name` | string(191) | — |
| 28 | Star ID | `star_external_id` | string(191) | — |
| 29 | Star Phone | `star_phone` | string(191) | — |
| 62 | Last Outbound Agent | `last_outbound_agent` | string(191) | — |
| 95 | Virtual Star ID | `virtual_star_external_id` | string(191) | — |
| 96 | First Receiving By | `first_receiving_by` | string(191) | — |
| 98 | Collected From Consignee by | `collected_from_consignee_by` | string(191) | — |
| 103 | Address Type | `address_type` | string(191) | — |
| 126 | L2 Street Code | `l2_street_code` | string(191) | — |

### shipment_snapshot_routing — 22 عنوانًا

| # | اسم عمود المصدر | العمود المقترح | نوع البيانات المبدئي | المجموعة |
|---:|---|---|---|---|
| 38 | Current Hub | `current_hub_name` | string(191) | — |
| 39 | Current Hub Display Code | `current_hub_display_code` | string(191) | — |
| 40 | Current Parent Hub Display Code | `current_parent_hub_display_code` | string(191) | — |
| 44 | Received Time | `received_at` | dateTime | — |
| 45 | Location Inside Hub | `location_inside_hub` | string(191) | — |
| 49 | Warehouse Tarnsit Seal Number | `warehouse_transit_seal_number` | string(191) | — |
| 51 | In Transit To | `in_transit_to` | string(191) | — |
| 60 | Loss Liable Hub Name | `loss_liable_hub_name` | string(191) | — |
| 65 | Assigned Hub | `assigned_hub_name` | string(191) | — |
| 66 | Assigned Hub Display Code | `assigned_hub_display_code` | string(191) | — |
| 67 | Assigned Parent Hub Display Code | `assigned_parent_hub_display_code` | string(191) | — |
| 68 | Auto Assigned Hub | `auto_assigned_hub_name` | string(191) | — |
| 77 | Last Transfer Date | `last_transfer_date` | dateTime | — |
| 87 | Pickup Sector | `pickup_sector` | string(191) | — |
| 88 | Dropoff Sector | `dropoff_sector` | string(191) | — |
| 94 | First Hub | `first_hub_name` | string(191) | — |
| 97 | Last Dispatch Hub | `last_dispatch_hub_name` | string(191) | — |
| 100 | Seal Number | `seal_number` | string(100) | — |
| 101 | Barcode Reference | `barcode_reference` | string(100) | — |
| 108 | Received Transfer date | `received_transfer_at` | dateTime | — |
| 109 | First Mile District Code | `first_mile_district_code` | string(191) | — |
| 127 | Added To Route Date | `added_to_route_at` | dateTime | — |

### shipment_snapshot_financials — 24 عنوانًا

| # | اسم عمود المصدر | العمود المقترح | نوع البيانات المبدئي | المجموعة |
|---:|---|---|---|---|
| 25 | Cod Amount | `cod_amount` | decimal(18,4) | — |
| 26 | Original Cod Amount | `original_cod_amount` | decimal(18,4) | — |
| 70 | Price Before VAT | `price_before_vat` | decimal(18,4) | — |
| 71 | Price After VAT | `price_after_vat` | decimal(18,4) | — |
| 72 | Zero COD Discount | `zero_cod_discount` | decimal(18,4) | — |
| 73 | Extra COD Fees | `extra_cod_fees` | decimal(18,4) | — |
| 74 | Insurance Fees | `insurance_fees` | decimal(18,4) | — |
| 75 | Next Day Fees | `next_day_fees` | decimal(18,4) | — |
| 76 | Promotion Discount | `promotion_discount` | decimal(18,4) | — |
| 110 | Custom VAT Type | `custom_vat_type` | string(191) | — |
| 111 | Custom VAT Value | `custom_vat_value` | decimal(18,4) | — |
| 123 | Goods Value | `goods_value` | decimal(18,4) | — |
| 124 | Proof of cost Attachment Date | `proof_of_cost_attachment_at` | dateTime | — |
| 128 | Flex Ship Value | `flex_ship_value` | decimal(18,4) | — |
| 129 | Flex Ship Fees | `flex_ship_fees` | decimal(18,4) | — |
| 130 | Flex Ship Payment status | `flex_ship_payment_status` | string(191) | — |
| 131 | Flex Ship Star ID | `flex_ship_star_external_id` | string(191) | — |
| 132 | Flex Ship Star Name | `flex_ship_star_name` | string(191) | — |
| 133 | Flex Ship Collection Date | `flex_ship_collection_date` | dateTime | — |
| 134 | Flex Ship Tips | `flex_ship_tips` | decimal(18,4) | — |
| 135 | Flash Tips | `flash_tips` | decimal(18,4) | — |
| 136 | Online Payment Provider | `online_payment_provider` | string(191) | — |
| 137 | Brand ID | `brand_external_id` | string(191) | — |
| 138 | Brand Name | `brand_name` | string(191) | — |

### shipment_snapshot_service — 22 عنوانًا

| # | اسم عمود المصدر | العمود المقترح | نوع البيانات المبدئي | المجموعة |
|---:|---|---|---|---|
| 46 | Is WhatsApp Cancellation | `is_whats_app_cancellation` | boolean | — |
| 47 | Cancellation Time | `cancellation_time` | dateTime | — |
| 48 | Cancellation Reason | `cancellation_reason` | text | — |
| 59 | Lost Liability Reasons | `lost_liability_reasons` | text | — |
| 78 | No. of phone calls | `phone_calls_count` | unsignedInteger | — |
| 79 | Last phone call date time | `last_phone_call_at` | dateTime | — |
| 80 | No. of SMS | `sms_count` | unsignedInteger | — |
| 81 | Last SMS date time | `last_sms_at` | dateTime | — |
| 102 | Latest Exception Reason | `latest_exception_reason` | text | — |
| 105 | New material request | `new_material_request` | string(191) | — |
| 112 | Star Rating | `star_rating` | decimal(14,3) | — |
| 113 | Star Comment | `star_comment` | text | — |
| 114 | Service Rating | `service_rating` | decimal(14,3) | — |
| 115 | Service Comment | `service_comment` | text | — |
| 116 | Escalation Severity Level | `escalation_severity_level` | string(191) | — |
| 117 | Escalated At | `escalated_at` | dateTime | — |
| 118 | Latest Severity Update Date | `latest_severity_update_date` | dateTime | — |
| 119 | Ticket Number | `ticket_number` | string(100) | — |
| 120 | Ticket Category | `ticket_category` | string(191) | — |
| 121 | Scheduled By Business | `scheduled_by_business` | string(191) | — |
| 122 | Scheduled By Consignee | `scheduled_by_consignee` | string(191) | — |
| 125 | Allow TO Open Package | `allow_to_open_package` | boolean | — |

### delivery_attempts — 72 عنوانًا

| # | اسم عمود المصدر | العمود المقترح | نوع البيانات المبدئي | المجموعة |
|---:|---|---|---|---|
| 139 | Attempt Type | `attempt_type` | string(100) | 0 |
| 140 | Attempt By | `attempt_by` | string(191) | 0 |
| 141 | Attempt HuB Name | `attempt_hub_name` | string(191) | 0 |
| 142 | Attempt Date | `attempt_at` | dateTime | 0 |
| 143 | Exception Fake Attempt | `exception_fake_attempt` | boolean | 0 |
| 144 | Exception Reason | `exception_reason` | text | 0 |
| 145 | Exception time | `exception_at` | dateTime | 0 |
| 146 | Exception lat/long | `exception_lat_long` | string(191) | 0 |
| 147 | Attempt 1 Type | `attempt_type` | string(100) | 1 |
| 148 | Attempt 1 By | `attempt_by` | string(191) | 1 |
| 149 | Attempt 1 HuB Name | `attempt_hub_name` | string(191) | 1 |
| 150 | Attempt 1 Date | `attempt_at` | dateTime | 1 |
| 151 | Exception 1 Fake Attempt | `exception_fake_attempt` | boolean | 1 |
| 152 | Exception 1 Reason | `exception_reason` | text | 1 |
| 153 | Exception 1 time | `exception_at` | dateTime | 1 |
| 154 | Exception 1 lat/long | `exception_lat_long` | string(191) | 1 |
| 155 | Attempt 2 Type | `attempt_type` | string(100) | 2 |
| 156 | Attempt 2 By | `attempt_by` | string(191) | 2 |
| 157 | Attempt 2 HuB Name | `attempt_hub_name` | string(191) | 2 |
| 158 | Attempt 2 Date | `attempt_at` | dateTime | 2 |
| 159 | Exception 2 Fake Attempt | `exception_fake_attempt` | boolean | 2 |
| 160 | Exception 2 Reason | `exception_reason` | text | 2 |
| 161 | Exception 2 time | `exception_at` | dateTime | 2 |
| 162 | Exception 2 lat/long | `exception_lat_long` | string(191) | 2 |
| 163 | Attempt 3 Type | `attempt_type` | string(100) | 3 |
| 164 | Attempt 3 By | `attempt_by` | string(191) | 3 |
| 165 | Attempt 3 HuB Name | `attempt_hub_name` | string(191) | 3 |
| 166 | Attempt 3 Date | `attempt_at` | dateTime | 3 |
| 167 | Exception 3 Fake Attempt | `exception_fake_attempt` | boolean | 3 |
| 168 | Exception 3 Reason | `exception_reason` | text | 3 |
| 169 | Exception 3 time | `exception_at` | dateTime | 3 |
| 170 | Exception 3 lat/long | `exception_lat_long` | string(191) | 3 |
| 171 | Attempt 4 Type | `attempt_type` | string(100) | 4 |
| 172 | Attempt 4 By | `attempt_by` | string(191) | 4 |
| 173 | Attempt 4 HuB Name | `attempt_hub_name` | string(191) | 4 |
| 174 | Attempt 4 Date | `attempt_at` | dateTime | 4 |
| 175 | Exception 4 Fake Attempt | `exception_fake_attempt` | boolean | 4 |
| 176 | Exception 4 Reason | `exception_reason` | text | 4 |
| 177 | Exception 4 time | `exception_at` | dateTime | 4 |
| 178 | Exception 4 lat/long | `exception_lat_long` | string(191) | 4 |
| 179 | Attempt 5 Type | `attempt_type` | string(100) | 5 |
| 180 | Attempt 5 By | `attempt_by` | string(191) | 5 |
| 181 | Attempt 5 HuB Name | `attempt_hub_name` | string(191) | 5 |
| 182 | Attempt 5 Date | `attempt_at` | dateTime | 5 |
| 183 | Exception 5 Fake Attempt | `exception_fake_attempt` | boolean | 5 |
| 184 | Exception 5 Reason | `exception_reason` | text | 5 |
| 185 | Exception 5 time | `exception_at` | dateTime | 5 |
| 186 | Exception 5 lat/long | `exception_lat_long` | string(191) | 5 |
| 187 | Attempt 6 Type | `attempt_type` | string(100) | 6 |
| 188 | Attempt 6 By | `attempt_by` | string(191) | 6 |
| 189 | Attempt 6 HuB Name | `attempt_hub_name` | string(191) | 6 |
| 190 | Attempt 6 Date | `attempt_at` | dateTime | 6 |
| 191 | Exception 6 Fake Attempt | `exception_fake_attempt` | boolean | 6 |
| 192 | Exception 6 Reason | `exception_reason` | text | 6 |
| 193 | Exception 6 time | `exception_at` | dateTime | 6 |
| 194 | Exception 6 lat/long | `exception_lat_long` | string(191) | 6 |
| 195 | Attempt 7 Type | `attempt_type` | string(100) | 7 |
| 196 | Attempt 7 By | `attempt_by` | string(191) | 7 |
| 197 | Attempt 7 HuB Name | `attempt_hub_name` | string(191) | 7 |
| 198 | Attempt 7 Date | `attempt_at` | dateTime | 7 |
| 199 | Exception 7 Fake Attempt | `exception_fake_attempt` | boolean | 7 |
| 200 | Exception 7 Reason | `exception_reason` | text | 7 |
| 201 | Exception 7 time | `exception_at` | dateTime | 7 |
| 202 | Exception 7 lat/long | `exception_lat_long` | string(191) | 7 |
| 203 | Attempt 8 Type | `attempt_type` | string(100) | 8 |
| 204 | Attempt 8 By | `attempt_by` | string(191) | 8 |
| 205 | Attempt 8 HuB Name | `attempt_hub_name` | string(191) | 8 |
| 206 | Attempt 8 Date | `attempt_at` | dateTime | 8 |
| 207 | Exception 8 Fake Attempt | `exception_fake_attempt` | boolean | 8 |
| 208 | Exception 8 Reason | `exception_reason` | text | 8 |
| 209 | Exception 8 time | `exception_at` | dateTime | 8 |
| 210 | Exception 8 lat/long | `exception_lat_long` | string(191) | 8 |


## 14. القرارات التي يجب اعتمادها قبل Production

1. هل رقم Tracking فريد على المؤسسة أم حساب Business؟
2. ما المصدر الرسمي لـ Report Date؟ تاريخ اسم الملف أم عمود الحدث أم اختيار يدوي؟ وما المنطقة الزمنية؟
3. هل مجموعة Attempt غير المرقمة تعني أحدث محاولة أو محاولة مستقلة؟
4. هل يسمح باستيراد ملفين مختلفين لنفس اليوم؟ وكيف تُحسب Observations وقتئذ؟
5. ما سياسة الأخطاء المقبولة: رفض كل الملف، أو قبول صالح مع Issues، أو رفض صفوف فقط؟
6. هل القيم المالية بعملة واحدة؟ وهل أعمدة COD وVAT لها دلالة خاصة بشركة Bosta؟
7. ما الحساسية المسموح عرضها/تصديرها للمستخدمين ومراكز الشحن؟
8. هل مطلوب On-premise أم VPS؟ وهل توجد موارد كافية لعمليات Redis Workers المستمرة؟

لا تفترض إجابة من عينة واحدة؛ نفذ MVP مع افتراضات واضحة قابلة للتعديل وموافقة مسؤول البيانات قبل النشر.
