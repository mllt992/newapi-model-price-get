import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// 初始化数据库
const db = new Database(join(__dirname, 'data', 'prices.db'));

// 创建表
db.exec(`
  CREATE TABLE IF NOT EXISTS models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    model_name TEXT NOT NULL,
    display_name TEXT,
    description TEXT,
    context_length INTEGER,
    price_prompt REAL,
    price_completion REAL,
    currency TEXT DEFAULT 'CNY',
    unit TEXT DEFAULT '/ M Tokens',
    status TEXT DEFAULT 'online',
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(platform, model_name)
  );

  CREATE TABLE IF NOT EXISTS sync_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    status TEXT NOT NULL,
    model_count INTEGER,
    error_message TEXT,
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_platform ON models(platform);
  CREATE INDEX IF NOT EXISTS idx_model_name ON models(model_name);
`);

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// 同步 API
const SYNC_APIS = {
  siliconflow: {
    name: 'SiliconFlow',
    url: 'https://busy-bear.siliconflow.cn/api/v1/playground/comprehensive/all',
    headers: {
      'Authorization': `Bearer ${process.env.SILICONFLOW_API_KEY || 'YOUR_SILICONFLOW_API_KEY'}`
    }
  },
  modelsdev: {
    name: 'models.dev',
    url: 'https://models.dev/api.json'
  }
};

// 同步 SiliconFlow 数据
async function syncSiliconFlow() {
  const config = SYNC_APIS.siliconflow;
  console.log(`[${new Date().toISOString()}] 开始同步 SiliconFlow...`);

  try {
    const response = await axios.get(config.url, {
      headers: config.headers,
      timeout: 60000
    });

    const data = response.data;
    if (!data.status || data.code !== 20000) {
      throw new Error(data.message || 'API 返回错误');
    }

    const models = data.data?.models || [];
    let inserted = 0, updated = 0;

    const stmt = db.prepare(`
      INSERT INTO models (platform, model_name, display_name, description, context_length,
                          price_prompt, price_completion, currency, unit, status, metadata, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(platform, model_name) DO UPDATE SET
        display_name = excluded.display_name,
        description = excluded.description,
        context_length = excluded.context_length,
        price_prompt = excluded.price_prompt,
        price_completion = excluded.price_completion,
        status = excluded.status,
        metadata = excluded.metadata,
        updated_at = CURRENT_TIMESTAMP
    `);

    const transaction = db.transaction(() => {
      for (const model of models) {
        const pricing = model.pricing || [];
        let pricePrompt = null, priceCompletion = null;

        for (const p of pricing) {
          if (p.unitOfGood === '/ M Tokens') {
            const price = parseFloat(p.price) || 0;
            if (p.specification === 'prompt') pricePrompt = price;
            if (p.specification === 'completion') priceCompletion = price;
          }
        }

        stmt.run(
          'siliconflow',
          model.modelName,
          model.displayName || model.modelName,
          model.desc || '',
          model.contextLen || null,
          pricePrompt,
          priceCompletion,
          model.currency || '¥',
          '/ M Tokens',
          model.status || 'online',
          JSON.stringify({ modelId: model.modelId, tags: model.tags || [] })
        );

        if (db.changes > 0) {
          updated++;
        } else {
          inserted++;
        }
      }
    });

    transaction();

    // 记录同步历史
    db.prepare(`INSERT INTO sync_history (platform, status, model_count) VALUES (?, 'success', ?)`)
      .run('siliconflow', models.length);

    console.log(`[${new Date().toISOString()}] SiliconFlow 同步完成: ${models.length} 个模型`);
    return { success: true, count: models.length };

  } catch (error) {
    const message = error.response?.data?.message || error.message;
    console.error(`[${new Date().toISOString()}] SiliconFlow 同步失败:`, message);

    db.prepare(`INSERT INTO sync_history (platform, status, error_message) VALUES (?, 'failed', ?)`)
      .run('siliconflow', message);

    return { success: false, error: message };
  }
}

// 同步 models.dev 数据
async function syncModelsDev() {
  console.log(`[${new Date().toISOString()}] 开始同步 models.dev...`);

  try {
    const response = await axios.get(SYNC_APIS.modelsdev.url, { timeout: 60000 });
    const data = response.data;

    let count = 0;
    const stmt = db.prepare(`
      INSERT INTO models (platform, model_name, display_name, description, price_prompt, price_completion, currency, unit, metadata, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(platform, model_name) DO UPDATE SET
        price_prompt = excluded.price_prompt,
        price_completion = excluded.price_completion,
        updated_at = CURRENT_TIMESTAMP
    `);

    const transaction = db.transaction(() => {
      for (const [provider, providerData] of Object.entries(data)) {
        const models = providerData.models || {};
        for (const [modelName, modelData] of Object.entries(models)) {
          const cost = modelData.cost || {};
          const fullName = `${provider}/${modelName}`;

          stmt.run(
            'modelsdev',
            fullName,
            modelName,
            '',
            cost.input ? cost.input / 2 : null,  // 转换为 USD
            cost.output ? cost.output / cost.input : null,
            'USD',
            '/ M Tokens',
            JSON.stringify({ provider })
          );
          count++;
        }
      }
    });

    transaction();

    db.prepare(`INSERT INTO sync_history (platform, status, model_count) VALUES (?, 'success', ?)`)
      .run('modelsdev', count);

    console.log(`[${new Date().toISOString()}] models.dev 同步完成: ${count} 个模型`);
    return { success: true, count };

  } catch (error) {
    const message = error.message;
    console.error(`[${new Date().toISOString()}] models.dev 同步失败:`, message);

    db.prepare(`INSERT INTO sync_history (platform, status, error_message) VALUES (?, 'failed', ?)`)
      .run('modelsdev', message);

    return { success: false, error: message };
  }
}

// API 路由
// 获取所有模型
app.get('/api/models', (req, res) => {
  const { platform, search, sort, order, page = 1, limit = 50 } = req.query;

  let whereClause = 'WHERE 1=1';
  const params = [];

  if (platform) {
    whereClause += ' AND platform = ?';
    params.push(platform);
  }

  if (search) {
    whereClause += ' AND (model_name LIKE ? OR display_name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  const sortField = ['price_prompt', 'price_completion', 'model_name', 'updated_at'].includes(sort) ? sort : 'model_name';
  const sortOrder = order === 'desc' ? 'DESC' : 'ASC';

  try {
    // 获取总数
    const countStmt = db.prepare(`SELECT COUNT(*) as total FROM models ${whereClause}`);
    const total = countStmt.get(...params).total;

    // 分页查询
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const dataStmt = db.prepare(`SELECT * FROM models ${whereClause} ORDER BY ${sortField} ${sortOrder} LIMIT ? OFFSET ?`);
    const models = dataStmt.all(...params, parseInt(limit), offset);

    res.json({ success: true, data: models, total: total });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取平台列表
app.get('/api/platforms', (req, res) => {
  try {
    const platforms = db.prepare(`
      SELECT platform, COUNT(*) as model_count, MAX(updated_at) as last_sync
      FROM models GROUP BY platform
    `).all();
    res.json({ success: true, data: platforms });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 同步接口
app.post('/api/sync', async (req, res) => {
  const { platform } = req.body;

  try {
    if (platform === 'siliconflow' || !platform) {
      await syncSiliconFlow();
    }
    if (platform === 'modelsdev' || !platform) {
      await syncModelsDev();
    }

    res.json({ success: true, message: '同步完成' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取同步历史
app.get('/api/sync/history', (req, res) => {
  try {
    const history = db.prepare(`
      SELECT * FROM sync_history ORDER BY synced_at DESC LIMIT 50
    `).all();
    res.json({ success: true, data: history });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 公开数据格式 (兼容 new-api 的 /api/ratio_config 格式)
app.get('/api/ratio_config', (req, res) => {
  try {
    const models = db.prepare('SELECT * FROM models').all();

    const modelRatio = {};
    const completionRatio = {};

    for (const m of models) {
      if (m.price_prompt !== null) {
        // 转换为 ratio: ¥/M -> ratio
        // factor = 500 / 7.3 / 1000 / 0.002 ≈ 34.246575
        modelRatio[m.model_name] = m.price_prompt * 34.246575;
      }
      if (m.price_completion !== null) {
        completionRatio[m.model_name] = m.price_completion;
      }
    }

    res.json({
      success: true,
      data: {
        model_ratio: modelRatio,
        completion_ratio: completionRatio
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取统计数据
app.get('/api/stats', (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) as count FROM models').get().count;
    const byPlatform = db.prepare(`
      SELECT platform, COUNT(*) as count FROM models GROUP BY platform
    `).all();
    const recentSync = db.prepare(`
      SELECT platform, status, model_count, synced_at FROM sync_history
      ORDER BY synced_at DESC LIMIT 10
    `).all();

    res.json({
      success: true,
      data: {
        total_models: total,
        by_platform: byPlatform,
        recent_sync: recentSync
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 页面路由
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.get('/sync', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'sync.html'));
});

// 启动时自动同步
async function init() {
  console.log('正在初始化数据...');

  try {
    await syncSiliconFlow();
    await syncModelsDev();
    console.log('初始化完成!');
  } catch (error) {
    console.error('初始化同步失败:', error.message);
  }

  app.listen(PORT, () => {
    console.log(`\n🚀 服务已启动: http://localhost:${PORT}`);
    console.log(`   - 模型列表: http://localhost:${PORT}/`);
    console.log(`   - 同步管理: http://localhost:${PORT}/sync`);
    console.log(`   - API 文档: http://localhost:${PORT}/api/models\n`);
  });
}

init();
