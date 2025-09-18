// webpack.config.js (ESM, wds v5 proxy format)
import path from 'path';
import { fileURLToPath } from 'url';
import HtmlWebpackPlugin from 'html-webpack-plugin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  mode: 'development',
  entry: './src/main.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.[contenthash].js',
    clean: true,
    publicPath: '/',
  },
  stats: 'errors-warnings',
  module: {
    rules: [{ test: /\.css$/i, use: ['style-loader', 'css-loader'] }],
  },
  plugins: [new HtmlWebpackPlugin({ template: './src/index.html', inject: 'body' })],
  devServer: {
    host: 'localhost',
    port: 9000,
    hot: true,
    historyApiFallback: true,
    static: false,
    // v5 requires an ARRAY (or a function). Use context + target.
    proxy: [
      {
        context: ['/api'],
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      },
    ],
  },
};
