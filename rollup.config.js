import pkg from './package.json';

export default [
    // browser-friendly UMD build
    {
        input: 'src/xmlfuse.js',
        output: {
            name: 'xmlfuse',
            file: pkg.main,
            format: 'umd',
            sourcemap: 'inline',
        }
    }
];
