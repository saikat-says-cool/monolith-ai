
import { query } from '../db.js';
import crypto from 'crypto';

const initKey = async () => {
    try {
        const check = await query('SELECT * FROM api_keys LIMIT 1');
        if (check.rows.length === 0) {
            const key = `pk-${crypto.randomBytes(24).toString('hex')}`;
            await query('INSERT INTO api_keys (key, name) VALUES ($1, $2)', [key, 'System Default']);
            console.log('Created new System Default API Key:', key);
        } else {
            console.log('Existing API Key found:', check.rows[0].key);
        }
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

initKey();
