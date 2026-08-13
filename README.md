# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://github.com/rolldown/rolldown))
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for reference.

## Deploying to Azure Cloud

This React + Vite application can be deployed to Azure using several methods. Follow the steps below to deploy to Azure Static Web Apps:

### Prerequisites

- An Azure subscription ([sign up for free](https://azure.microsoft.com/en-us/free/))
- [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) installed
- [Git](https://git-scm.com/) installed
- GitHub account with a fork of this repository

### Option 1: Deploy using Azure Static Web Apps (Recommended)

1. **Build the application locally**
   ```bash
   npm install
   npm run build
   ```

2. **Create a Static Web App in Azure**
   - Go to the [Azure Portal](https://portal.azure.com/)
   - Click "Create a resource" and search for "Static Web App"
   - Click "Create"
   - Fill in the following details:
     - Resource Group: Create new or select existing
     - Name: Enter a unique name for your app
     - Plan type: Select "Free"
     - Region: Choose your preferred region
   - Click "Sign in with GitHub" to authenticate

3. **Configure build details**
   - Select your GitHub organization and repository fork
   - Select the branch to deploy (usually `main`)
   - Build presets: Select "React"
   - App location: `/`
   - API location: Leave empty (unless you have an API)
   - Output location: `dist`

4. **Review and create**
   - Review your settings
   - Click "Create"
   - Azure will automatically trigger a build and deployment

5. **Monitor deployment**
   - Go to your Static Web App resource in Azure Portal
   - Click "Overview" to see your app URL
   - Monitor the build and deployment status under "Actions" in your GitHub repository

### Option 2: Deploy using Azure App Service

1. **Build the application**
   ```bash
   npm install
   npm run build
   ```

2. **Create an App Service**
   - Go to [Azure Portal](https://portal.azure.com/)
   - Click "Create a resource" and search for "App Service"
   - Click "Create"
   - Fill in the required details:
     - Resource Group: Create new or select existing
     - Name: Enter a unique name
     - Publish: Select "Code"
     - Runtime stack: Node
     - Operating System: Linux
     - Region: Choose your region

3. **Deploy using Azure CLI**
   ```bash
   # Login to Azure
   az login

   # Create a deployment package
   zip -r deploy.zip dist node_modules package.json package-lock.json

   # Deploy to App Service
   az webapp up --name <your-app-name> --resource-group <your-resource-group>
   ```

4. **Configure for Static Content**
   - Go to Configuration in App Service settings
   - Add environment variable: `NODE_ENV=production`
   - Restart the app service

### Option 3: Deploy using Docker

1. **Create a Dockerfile** in the root directory:
   ```dockerfile
   FROM node:18-alpine AS build
   WORKDIR /app
   COPY package*.json ./
   RUN npm install
   COPY . .
   RUN npm run build

   FROM node:18-alpine
   RUN npm install -g http-server
   WORKDIR /app
   COPY --from=build /app/dist ./dist
   EXPOSE 8080
   CMD ["http-server", "dist", "-p", "8080"]
   ```

2. **Build and push Docker image**
   ```bash
   docker build -t <your-registry>/guard-kingdom-gate:latest .
   docker push <your-registry>/guard-kingdom-gate:latest
   ```

3. **Deploy to Azure Container Instances**
   ```bash
   az container create \
     --resource-group <your-resource-group> \
     --name guard-kingdom-gate \
     --image <your-registry>/guard-kingdom-gate:latest \
     --ports 8080 \
     --dns-name-label guard-kingdom-gate
   ```

### Post-Deployment

- **Access your application**: Navigate to the URL provided by Azure
- **View logs**: Check Azure Portal for application logs and diagnostics
- **Set up custom domain**: Configure a custom domain in your Static Web App or App Service settings
- **Enable HTTPS**: Azure automatically enables HTTPS for all deployments
- **Configure CI/CD**: The GitHub Actions workflow is automatically created for automatic deployments on commits

### Environment Variables

If your application requires environment variables, add them in Azure Portal:
- For Static Web Apps: Go to Settings → Configuration
- For App Service: Go to Settings → Configuration → Application settings

### Troubleshooting

- **Build fails**: Ensure `npm run build` works locally and produces a `dist/` folder
- **App not loading**: Check that the output location is set correctly to `dist`
- **404 errors**: Configure fallback routing to serve `index.html` for client-side routes

For more information, visit the [Azure Static Web Apps documentation](https://learn.microsoft.com/en-us/azure/static-web-apps/).
