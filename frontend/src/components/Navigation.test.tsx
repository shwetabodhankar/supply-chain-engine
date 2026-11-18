import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { ThemeProvider } from '../context/ThemeContext';
import Navigation from './Navigation';

const publicLinks = ['Home', 'Products', 'About us'];

function SignInControl() {
  const { login } = useAuth();
  return <button onClick={() => login('admin@github.com', 'password')}>Sign in as admin</button>;
}

function renderNavigation(path = '/', theme = 'light') {
  window.history.replaceState(null, '', path);
  localStorage.setItem('theme', theme);
  render(
    <BrowserRouter>
      <AuthProvider>
        <ThemeProvider>
          <Navigation />
          <SignInControl />
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>,
  );
  return userEvent.setup();
}

function expectCurrentLink(currentLink?: string, theme = 'light') {
  for (const name of publicLinks) {
    const link = screen.getByRole('link', { name });
    if (name === currentLink) {
      expect(link).toHaveAttribute('aria-current', 'page');
      expect(link).toHaveClass('text-primary', 'underline', 'underline-offset-4');
    } else {
      expect(link).not.toHaveAttribute('aria-current');
      expect(link).not.toHaveClass('underline');
      expect(link).toHaveClass(theme === 'dark' ? 'text-light' : 'text-gray-700');
    }
  }
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.classList.remove('light', 'dark');
  window.history.replaceState(null, '', '/');
});

describe.each(['light', 'dark'])('storefront navigation in the %s theme', (theme) => {
  it.each([
    ['/', 'Home'],
    ['/products', 'Products'],
    ['/about', 'About us'],
    ['/products?search=feeder#catalog', 'Products'],
    ['/login', undefined],
    ['/admin/products', undefined],
    ['/products-extra', undefined],
  ])('marks only the matching public link on direct loading of %s', (path, currentLink) => {
    renderNavigation(path, theme);

    expectCurrentLink(currentLink, theme);
    expect(document.documentElement).toHaveClass(theme);
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Products' })).toHaveAttribute('href', '/products');
    expect(screen.getByRole('link', { name: 'About us' })).toHaveAttribute('href', '/about');
  });

  it('updates after link navigation and browser back/forward', async () => {
    const user = renderNavigation('/', theme);
    expectCurrentLink('Home', theme);

    await user.click(screen.getByRole('link', { name: 'Products' }));
    expect(window.location.pathname).toBe('/products');
    expectCurrentLink('Products', theme);

    await user.click(screen.getByRole('link', { name: 'About us' }));
    expect(window.location.pathname).toBe('/about');
    expectCurrentLink('About us', theme);

    window.history.back();
    await waitFor(() => expectCurrentLink('Products', theme));
    window.history.back();
    await waitFor(() => expectCurrentLink('Home', theme));
    window.history.forward();
    await waitFor(() => expectCurrentLink('Products', theme));
  });

  it('keeps public links keyboard accessible with visible focus styling', async () => {
    const user = renderNavigation('/', theme);
    await user.tab();

    for (const name of publicLinks) {
      await user.tab();
      expect(screen.getByRole('link', { name })).toHaveFocus();
      expect(screen.getByRole('link', { name })).toHaveClass(
        'focus-visible:outline-2',
        'focus-visible:outline-offset-2',
        'focus-visible:outline-primary',
      );
    }
    await user.keyboard('{Enter}');
    expectCurrentLink('About us', theme);
  });
});

it('preserves login, logout, the theme toggle, and the admin menu', async () => {
  const user = renderNavigation('/products');

  await user.click(screen.getByRole('button', { name: 'Toggle dark/light mode' }));
  expect(document.documentElement).toHaveClass('dark');
  expectCurrentLink('Products', 'dark');

  await user.click(screen.getByRole('link', { name: 'Login' }));
  expect(window.location.pathname).toBe('/login');
  expectCurrentLink(undefined, 'dark');

  await user.click(screen.getByRole('button', { name: 'Sign in as admin' }));
  expect(screen.queryByRole('link', { name: 'Login' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Admin' }));
  await user.click(screen.getByRole('link', { name: 'Manage Products' }));
  expect(window.location.pathname).toBe('/admin/products');
  expect(screen.queryByRole('link', { name: 'Manage Products' })).not.toBeInTheDocument();
  expectCurrentLink(undefined, 'dark');

  await user.click(screen.getByRole('button', { name: 'Logout' }));
  expect(screen.queryByRole('button', { name: 'Admin' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Login' })).toHaveAttribute('href', '/login');
});
