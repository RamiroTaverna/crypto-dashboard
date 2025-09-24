import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: 'dashboard',
    loadChildren: () =>
      import('./features/dashboard/dashboard.routes').then(m => m.default),
  },
  {
    path: 'coin',
    loadChildren: () =>
      import('./features/coin/coin.routes').then(m => m.default),
  },
  { path: '**', redirectTo: 'dashboard' },
];
