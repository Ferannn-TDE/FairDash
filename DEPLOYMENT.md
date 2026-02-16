# 🚀 FairDash Deployment Guide

## Quick Deploy Options

### Option 1: Netlify (Recommended)

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin YOUR_REPO_URL
   git push -u origin main
   ```

2. **Deploy on Netlify**
   - Go to [netlify.com](https://netlify.com)
   - Click "Add new site" → "Import an existing project"
   - Connect to GitHub and select your repo
   - Build settings:
     - Build command: `npm run build`
     - Publish directory: `dist`
   - Click "Deploy"

3. **Custom Domain**
   - Go to Site settings → Domain management
   - Add custom domain: `fairdash.net`
   - Update DNS records as instructed

### Option 2: Vercel

1. **Install Vercel CLI**
   ```bash
   npm i -g vercel
   ```

2. **Deploy**
   ```bash
   cd fairdash-app
   vercel
   ```

3. **Production Deploy**
   ```bash
   vercel --prod
   ```

### Option 3: GitHub Pages

1. **Install gh-pages**
   ```bash
   npm install --save-dev gh-pages
   ```

2. **Update package.json**
   ```json
   {
     "homepage": "https://YOUR_USERNAME.github.io/fairdash",
     "scripts": {
       "predeploy": "npm run build",
       "deploy": "gh-pages -d dist"
     }
   }
   ```

3. **Update vite.config.js**
   ```javascript
   export default defineConfig({
     plugins: [react()],
     base: '/fairdash/'
   })
   ```

4. **Deploy**
   ```bash
   npm run deploy
   ```

## Environment Variables

If you add API keys or backend URLs:

1. **Create `.env` file**
   ```
   VITE_API_URL=https://api.fairdash.net
   VITE_STRIPE_KEY=pk_test_...
   ```

2. **Access in code**
   ```javascript
   const apiUrl = import.meta.env.VITE_API_URL;
   ```

3. **Add to hosting platform**
   - Netlify: Site settings → Environment variables
   - Vercel: Project settings → Environment Variables

## Build Optimization

### Analyze Bundle Size
```bash
npm run build -- --mode production
```

### Performance Tips
1. Enable lazy loading for routes
2. Optimize images (use WebP)
3. Add service worker for PWA
4. Enable gzip compression
5. Use CDN for static assets

## Custom Domain Setup

### DNS Configuration for fairdash.net

1. **Netlify DNS**
   ```
   A Record:  @  →  75.2.60.5
   CNAME:  www  →  YOUR_SITE.netlify.app
   ```

2. **Cloudflare (Recommended)**
   - Add site to Cloudflare
   - Update nameservers
   - Enable SSL/TLS
   - Enable Auto Minify
   - Enable Brotli compression

## SSL Certificate

All recommended platforms provide free SSL:
- Netlify: Automatic Let's Encrypt
- Vercel: Automatic
- Cloudflare: Free SSL

## Monitoring & Analytics

### Add Analytics
```html
<!-- Add to index.html -->
<script async src="https://www.googletagmanager.com/gtag/js?id=GA_ID"></script>
```

### Error Tracking
Consider adding:
- Sentry for error monitoring
- LogRocket for session replay

## CI/CD Pipeline

### GitHub Actions Example
Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [ main ]

jobs:
  build:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        
    - name: Install dependencies
      run: npm ci
      
    - name: Build
      run: npm run build
      
    - name: Deploy to Netlify
      uses: netlify/actions/cli@master
      with:
        args: deploy --prod
      env:
        NETLIFY_AUTH_TOKEN: ${{ secrets.NETLIFY_AUTH_TOKEN }}
        NETLIFY_SITE_ID: ${{ secrets.NETLIFY_SITE_ID }}
```

## Rollback Strategy

### Netlify
- Go to Deploys → Find previous deploy → Publish

### Vercel
```bash
vercel rollback
```

### Git-based
```bash
git revert HEAD
git push
```

## Performance Checklist

- [ ] Enable compression
- [ ] Optimize images
- [ ] Minimize bundle size
- [ ] Enable caching headers
- [ ] Use CDN
- [ ] Add service worker
- [ ] Enable HTTP/2
- [ ] Lazy load routes
- [ ] Preload critical assets

## Post-Deployment

1. **Test on Multiple Devices**
   - Desktop browsers
   - Mobile browsers
   - Tablet sizes

2. **Check Performance**
   - Google PageSpeed Insights
   - Lighthouse audit
   - WebPageTest

3. **Monitor**
   - Setup uptime monitoring
   - Configure alerts
   - Check error logs

## Troubleshooting

### Build Fails
- Clear node_modules: `rm -rf node_modules && npm install`
- Check Node version: `node -v` (should be 16+)
- Review build logs

### 404 on Refresh
Add `_redirects` file to public folder:
```
/*    /index.html   200
```

### Slow Loading
- Check bundle size
- Enable code splitting
- Optimize images
- Use lazy loading

---

For questions or issues, refer to the platform-specific documentation:
- [Netlify Docs](https://docs.netlify.com)
- [Vercel Docs](https://vercel.com/docs)
- [Vite Deploy Guide](https://vitejs.dev/guide/static-deploy.html)
