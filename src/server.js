import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { startScheduler } from './scheduler.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const { app, sms, payments } = createApp({ db, config });

startScheduler(db, config, sms);

app.listen(config.port, () => {
  console.log(`🦷 سواك يعمل على ${config.baseUrl}`);
  console.log(`   payments: ${payments.name} · sms: ${sms.provider} · timezone: ${config.timezone}`);
  console.log(`   لوحة التحكم: ${config.baseUrl}/admin`);
});
