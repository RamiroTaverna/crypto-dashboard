import { Routes } from '@angular/router';
import { CoinDetailPageComponent } from './pages/coin-detail-page/coin-detail-page.component';

export default [
  { path: ':id', component: CoinDetailPageComponent }
] as Routes;
