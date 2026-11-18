import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeProvider } from '../../../context/ThemeContext';
import Products from './Products';

const products = [
  { productId: 1, name: 'Zulu Feeder', description: 'Automatic meals', price: 40 },
  { productId: 2, name: 'alpha Bowl', description: 'Feeder accessory', price: 100, discount: 0.8 },
  { productId: 3, name: 'Beta Feeder', description: 'Scheduled meals', price: 30, discount: 0 },
  { productId: 4, name: 'Gamma Toy', description: 'Play time', price: 50, discount: -0.1 },
  { productId: 5, name: 'Delta Bed', description: 'Nap time', price: 20.004 },
].map((product) => ({
  imgName: 'product.png',
  sku: `SKU-${product.productId}`,
  unit: 'each',
  supplierId: 1,
  ...product,
}));

const queryClients: QueryClient[] = [];

function renderProducts(theme = 'light', catalog = products) {
  localStorage.setItem('theme', theme);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const cachedProducts = Object.freeze(catalog.map((product) => Object.freeze({ ...product })));
  queryClient.setQueryData(['products'], cachedProducts);
  queryClients.push(queryClient);

  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <Products />
      </ThemeProvider>
    </QueryClientProvider>,
  );

  return { user: userEvent.setup(), queryClient, cachedProducts };
}

function productNames() {
  return screen.queryAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
}

afterEach(() => {
  cleanup();
  queryClients.splice(0).forEach((queryClient) => queryClient.clear());
  localStorage.clear();
  document.documentElement.classList.remove('light', 'dark');
});

describe('storefront product sorting', () => {
  it('starts in API order and restores that order after sorting', async () => {
    const { user } = renderProducts();
    const sortControl = screen.getByRole('combobox', { name: 'Sort by' });

    expect(sortControl).toHaveValue('default');
    expect(productNames()).toEqual(products.map((product) => product.name));

    await user.selectOptions(sortControl, 'Name A-Z');
    expect(productNames()).toEqual([
      'alpha Bowl', 'Beta Feeder', 'Delta Bed', 'Gamma Toy', 'Zulu Feeder',
    ]);

    await user.selectOptions(sortControl, 'Default');
    expect(productNames()).toEqual(products.map((product) => product.name));
  });

  it('orders by displayed discounted price and keeps displayed-price ties in API order', async () => {
    const { user } = renderProducts();
    const sortControl = screen.getByRole('combobox', { name: 'Sort by' });

    await user.selectOptions(sortControl, 'Price Low-High');
    expect(productNames()).toEqual([
      'alpha Bowl', 'Delta Bed', 'Beta Feeder', 'Zulu Feeder', 'Gamma Toy',
    ]);
    const discountedCard = screen.getByRole('heading', { name: 'alpha Bowl' }).parentElement!;
    expect(within(discountedCard).getByText('$20.00')).toBeVisible();
    expect(within(discountedCard).getByText('$100.00')).toHaveClass('line-through');

    await user.selectOptions(sortControl, 'Price High-Low');
    expect(productNames()).toEqual([
      'Gamma Toy', 'Zulu Feeder', 'Beta Feeder', 'alpha Bowl', 'Delta Bed',
    ]);
  });

  it('sorts name and description matches without clearing search, including when returning to Default', async () => {
    const { user } = renderProducts();
    const searchControl = screen.getByRole('textbox', { name: 'Search products' });
    const sortControl = screen.getByRole('combobox', { name: 'Sort by' });

    await user.type(searchControl, 'feeder');
    await user.selectOptions(sortControl, 'Name A-Z');
    expect(searchControl).toHaveValue('feeder');
    expect(productNames()).toEqual(['alpha Bowl', 'Beta Feeder', 'Zulu Feeder']);

    await user.selectOptions(sortControl, 'Default');
    expect(searchControl).toHaveValue('feeder');
    expect(productNames()).toEqual(['Zulu Feeder', 'alpha Bowl', 'Beta Feeder']);

    await user.selectOptions(sortControl, 'Price High-Low');
    await user.clear(searchControl);
    await user.type(searchControl, 'nap');
    expect(sortControl).toHaveValue('price-desc');
    expect(productNames()).toEqual(['Delta Bed']);
  });

  it('leaves cached product order and values unchanged across every sort mode', async () => {
    const { user, queryClient, cachedProducts } = renderProducts();
    const sortControl = screen.getByRole('combobox', { name: 'Sort by' });

    for (const option of ['Name A-Z', 'Price Low-High', 'Price High-Low', 'Default']) {
      await user.selectOptions(sortControl, option);
      expect(queryClient.getQueryData(['products'])).toBe(cachedProducts);
      expect(queryClient.getQueryData(['products'])).toEqual(products);
    }
  });

  it.each(['light', 'dark'])('supports sorting and labeled keyboard access in the %s theme', async (theme) => {
    const { user } = renderProducts(theme);
    const sortControl = screen.getByRole('combobox', { name: 'Sort by' });

    await user.tab();
    expect(screen.getByRole('textbox', { name: 'Search products' })).toHaveFocus();
    await user.tab();
    expect(sortControl).toHaveFocus();
    expect(sortControl).toHaveClass(theme === 'dark' ? 'bg-gray-800' : 'bg-white');

    await user.selectOptions(sortControl, 'Price Low-High');
    expect(productNames()).toEqual([
      'alpha Bowl', 'Delta Bed', 'Beta Feeder', 'Zulu Feeder', 'Gamma Toy',
    ]);
    expect(document.documentElement).toHaveClass(theme);
  });

  it('keeps the empty search state and restores sorted results when search is cleared', async () => {
    const { user } = renderProducts();
    const searchControl = screen.getByRole('textbox', { name: 'Search products' });
    await user.type(searchControl, 'no matching product');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'Name A-Z');

    expect(screen.getByRole('status')).toHaveTextContent('No products found');
    expect(productNames()).toEqual([]);
    expect(searchControl).toHaveValue('no matching product');

    await user.clear(searchControl);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(productNames()).toEqual([
      'alpha Bowl', 'Beta Feeder', 'Delta Bed', 'Gamma Toy', 'Zulu Feeder',
    ]);
  });

  it('allows changing sort modes when the API returns an empty catalog', async () => {
    const { user } = renderProducts('light', []);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'Price High-Low');

    expect(screen.getByRole('status')).toHaveTextContent('No products found');
    expect(productNames()).toEqual([]);
  });
});
