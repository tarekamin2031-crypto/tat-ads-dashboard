# نشر الداشبورد (Turso + GitHub + Vercel)

## 0. توكن جديد (قبل النشر)
التوكن اللي اتجرب في الشات لازم يتلغى. من Meta Business Settings → System Users:
اعمل System User، اديله كل الحسابات الإعلانية، وولّد توكن بصلاحية `ads_read`.
التوكن الجديد هو `META_ACCESS_TOKEN` في كل الخطوات تحت.

## 1. قاعدة البيانات (Turso)
1. اعمل حساب على https://turso.tech (مجاني) وأنشئ database اسمها `tat-ads`.
2. من صفحة الـ database: انسخ **URL** (`libsql://...`) وأنشئ **Token** (Create token).

## 2. نقل العملاء الحاليين للقاعدة الأونلاين
من فولدر المشروع (باسورداتهم ولوجوهاتهم بتتنقل زي ما هي):

```bash
DATABASE_URL="libsql://..." DATABASE_AUTH_TOKEN="..." npm run push-accounts
DATABASE_URL="libsql://..." DATABASE_AUTH_TOKEN="..." META_ACCESS_TOKEN="..." npm run sync
```

## 3. GitHub (Repository خاص Private)
```bash
git commit -m "Meta ads dashboard"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```
بعدين في الـ repo: Settings → Secrets and variables → Actions، وأضف 3 Secrets:
`META_ACCESS_TOKEN` و`DATABASE_URL` و`DATABASE_AUTH_TOKEN`.
شغّل التحديث مرة يدويًا: Actions → Daily Meta Ads sync → Run workflow.
بعد كده بيشتغل لوحده كل يوم 6 صباحًا بتوقيت القاهرة.

## 4. Vercel
1. https://vercel.com → Add New → Project → اختار الـ repo.
2. Environment Variables:
   - `META_ACCESS_TOKEN`
   - `DATABASE_URL`, `DATABASE_AUTH_TOKEN`
   - `DASHBOARD_PASSWORD` (الباسورد الأول للـ `/admin`، بتدخل بيه بالإيميل `tarekamin2031@gmail.com` وبعدها تغيّره من "My account")
   - `ADMIN_EMAIL` (اختياري، الافتراضي `tarekamin2031@gmail.com`)
   - `SESSION_SECRET` (أي نص عشوائي طويل: `openssl rand -hex 32`)
3. Deploy. لينك العميل: `https://<your-app>.vercel.app/c/<slug>`.

## 5. بعد النشر
- افتح `/admin` وتأكد إن العملاء ظاهرين، وجرّب لينك عميل بباسورده.
- أضف باقي العملاء من `/admin` (بيسحب بياناتهم على طول).


## ربط TikTok / Google Ads
من `/admin/integrations` (زرار "Integrations" فوق) تلصق بيانات المنصة وتدوس "Save & pull data". بتتخزن مشفّرة في قاعدة البيانات، والـ sync اليومي في GitHub بيقراها من هناك.
الشرط الوحيد: `SESSION_SECRET` لازم يتضاف كـ Secret في GitHub (Settings ← Secrets and variables ← Actions) بنفس قيمته في Vercel، عشان الـ sync يفك التشفير.
