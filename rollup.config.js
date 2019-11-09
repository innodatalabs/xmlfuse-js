import resolve from 'rollup-plugin-node-resolve';

export default {
    external: ['@innodatalabs/lxmlx-js'],
    input: 'index.mjs',
    output: {
        name: 'xmlfuse',
        file: 'index.js',
        format: 'umd',
        sourcemap: true,
        globals: {
            '@innodatalabs/lxmlx-js': 'lxmlx'
        },
    },
    plugins: [
        resolve(),
    ]
};
