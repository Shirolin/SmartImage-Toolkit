import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export default tseslint.config(
    { ignores: ['lib/**', 'dist/**', 'log/**', 'node_modules/**'] },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    eslintPluginPrettierRecommended,
    {
        rules: {
            '@typescript-eslint/no-var-requires': 'off', // 允许使用 require，因为我们基于 CommonJS 开发
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/ban-ts-comment': 'off'
        }
    },
    {
        // CommonJS 启动脚本
        files: ['bootstrap.js'],
        languageOptions: {
            sourceType: 'commonjs',
            globals: {
                require: 'readonly',
                module: 'writable',
                __dirname: 'readonly',
                process: 'readonly',
                console: 'readonly'
            }
        },
        rules: {
            '@typescript-eslint/no-require-imports': 'off'
        }
    },
    {
        // 浏览器端 UI 脚本
        files: ['ui/**/*.js'],
        languageOptions: {
            sourceType: 'script',
            globals: {
                window: 'readonly',
                document: 'readonly',
                console: 'readonly',
                fetch: 'readonly',
                FormData: 'readonly',
                alert: 'readonly',
                confirm: 'readonly',
                setTimeout: 'readonly',
                setInterval: 'readonly',
                clearTimeout: 'readonly',
                clearInterval: 'readonly',
                URLSearchParams: 'readonly',
                AbortController: 'readonly',
                FileReader: 'readonly',
                Blob: 'readonly',
                Image: 'readonly',
                navigator: 'readonly',
                localStorage: 'readonly',
                requestAnimationFrame: 'readonly',
                CustomEvent: 'readonly',
                Event: 'readonly',
                history: 'readonly',
                location: 'readonly'
            }
        }
    }
);
