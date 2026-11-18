# React + TypeScript + Vite

## Storefront product search

On `/products`, **Showing X of Y products** reports the displayed results out of
the loaded catalog, including zero matches. Search matches names and descriptions
without regard to case. When the search is non-empty, **Clear search** resets only
the search text and returns focus to the input, preserving sorting and selected
quantities. The keyboard-accessible control remains available with no matches;
the existing empty state is unchanged. The controls support light/dark themes
and narrow screens.

## Storefront product sorting

On `/products`, use **Sort by** to select **Default**, **Name A-Z**,
**Price Low-High**, or **Price High-Low**. Sorting applies to the current
name/description search without clearing it. Default restores API order.
Price sorting uses the displayed two-decimal price, including positive
discounts; ties keep their original API order. Sorting is local to the page
and does not change cached products. The control supports light and dark themes.

Run the component tests and production build from `frontend`:

```powershell
npm test
npm run build
```

`npm test` runs Vitest component tests under `src` in jsdom, separately from
the existing Playwright suite (`npm run test:e2e`).

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default tseslint.config({
  extends: [
    // Remove ...tseslint.configs.recommended and replace with this
    ...tseslint.configs.recommendedTypeChecked,
    // Alternatively, use this for stricter rules
    ...tseslint.configs.strictTypeChecked,
    // Optionally, add this for stylistic rules
    ...tseslint.configs.stylisticTypeChecked,
  ],
  languageOptions: {
    // other options...
    parserOptions: {
      project: ['./tsconfig.node.json', './tsconfig.app.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default tseslint.config({
  plugins: {
    // Add the react-x and react-dom plugins
    'react-x': reactX,
    'react-dom': reactDom,
  },
  rules: {
    // other rules...
    // Enable its recommended typescript rules
    ...reactX.configs['recommended-typescript'].rules,
    ...reactDom.configs.recommended.rules,
  },
})
```
