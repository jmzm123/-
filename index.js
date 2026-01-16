const fs = require('fs');
const path = require('path');
const axios = require('axios');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// 配置
const API_KEY = process.env.ZHIPU_API_KEY;
const INPUT_FILE = 'ingredients.txt';
const OUTPUT_DIR = 'output';
const REFERENCE_IMAGE = 'style_reference.jpg'; // 参考图片文件名
// 默认 Prompt 模板 (当没有参考图时使用)
const DEFAULT_PROMPT_TEMPLATE = "A flat illustration of {ingredient}, centered, clean white background, simple style, no text, no watermark, high quality, for mobile app UI";

// 检查 API Key
if (!API_KEY || !API_KEY.includes('.')) {
    console.error('错误: 请在 .env 文件中配置正确的 ZHIPU_API_KEY (格式: id.secret)');
    process.exit(1);
}

// 生成 JWT Token
function generateToken(apiKey, expSeconds = 3600) {
    const [id, secret] = apiKey.split('.');
    const payload = {
        api_key: id,
        exp: Math.floor(Date.now() / 1000) + expSeconds,
        timestamp: Math.floor(Date.now() / 1000),
    };
    const header = {
        alg: 'HS256',
        sign_type: 'SIGN',
    };
    return jwt.sign(payload, secret, { header });
}

// 读取输入文件
function readIngredients() {
    try {
        const data = fs.readFileSync(INPUT_FILE, 'utf8');
        return data.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);
    } catch (error) {
        console.error(`无法读取文件 ${INPUT_FILE}:`, error.message);
        process.exit(1);
    }
}

// 下载并保存图片
async function downloadImage(url, filepath) {
    const writer = fs.createWriteStream(filepath);
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

// 主函数
async function main() {
    // 确保输出目录存在
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR);
    }

    const ingredients = readIngredients();
    console.log(`找到 ${ingredients.length} 个食材: ${ingredients.join(', ')}`);

    const token = generateToken(API_KEY);
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
    };

    // 尝试读取参考图片并提取风格
    const base64Image = getReferenceImageBase64();
    let stylePrompt = null;
    
    if (base64Image) {
        stylePrompt = await analyzeImageStyle(base64Image, token);
    }
    
    if (!stylePrompt) {
        console.log('未找到参考图片或分析失败，将使用默认 Prompt 模板。');
    }

    for (const [index, line] of ingredients.entries()) {
        // 支持 "英文,中文" 格式或纯英文格式
        const parts = line.split(/,|，/); // 支持中英文逗号
        const ingredientEn = parts[0].trim();
        const ingredientCn = parts.length > 1 ? parts[1].trim() : '';
        
        // 显示名称：如果有中文则显示 "Apple (苹果)"，否则只显示 "Apple"
        const displayName = ingredientCn ? `${ingredientEn} (${ingredientCn})` : ingredientEn;
        
        console.log(`[${index + 1}/${ingredients.length}] 正在生成: ${displayName}...`);
        
        let prompt;
        if (stylePrompt) {
            // 如果有提取到的风格，组合 Prompt: 物体 + 风格描述
            // 移除硬编码的背景设置，完全依赖参考图风格
            prompt = `${ingredientEn}, ${stylePrompt}`;
        } else {
            prompt = DEFAULT_PROMPT_TEMPLATE.replace('{ingredient}', ingredientEn);
        }
        
        try {
            const response = await axios.post('https://open.bigmodel.cn/api/paas/v4/images/generations', {
                model: 'cogview-3-flash', // 使用免费的图像生成模型
                prompt: prompt,
                size: '1024x1024', // cogview-3-flash 推荐尺寸
                user_id: 'user_123456' // 必须参数
            }, { headers });

            const imageUrl = response.data.data[0].url;
            // 文件名使用英文名
            const filename = path.join(OUTPUT_DIR, `${ingredientEn}.png`);
            
            console.log(`  下载图片到: ${filename}`);
            await downloadImage(imageUrl, filename);
            console.log('  完成!');

        } catch (error) {
            console.error(`  生成失败: ${error.message}`);
            if (error.response) {
                console.error('  API 响应:', JSON.stringify(error.response.data, null, 2));
            }
        }
    }
}

main();
