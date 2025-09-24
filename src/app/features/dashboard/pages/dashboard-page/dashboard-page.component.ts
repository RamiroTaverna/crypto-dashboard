import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MarketService } from '../../../../core/services/market/market.service';
import { MatTabsModule } from '@angular/material/tabs';
import { Subject, debounceTime, distinctUntilChanged, map } from 'rxjs';

@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTabsModule],
  templateUrl: './dashboard-page.component.html',
  styleUrls: ['./dashboard-page.component.scss']
})
export class DashboardPageComponent implements OnInit {
  private api = inject(MarketService);
  private router = inject(Router);

  // lista por defecto (popular)
  defaultIds = ['bitcoin', 'ethereum', 'solana', 'bnb', 'ripple'];

  // mapeo rápido símbolo/alias -> id de CoinGecko
  private alias: Record<string, string> = {
    btc: 'bitcoin', xbt: 'bitcoin', bitcoin: 'bitcoin',
    eth: 'ethereum', ethereum: 'ethereum',
    bnb: 'binancecoin', binance: 'binancecoin',
    xrp: 'ripple', ripple: 'ripple',
    sol: 'solana', solana: 'solana'
  };

  data: any[] = [];
  search = '';

  private search$ = new Subject<string>();

  ngOnInit() {
    // suscribimos al buscador con debounce
    this.search$
      .pipe(
        map(v => (v ?? '').trim().toLowerCase()),
        debounceTime(300),
        distinctUntilChanged()
      )
      .subscribe(term => this.fetchForTerm(term));

    // carga inicial (5 monedas por defecto)
    this.fetchDefault();
  }

  onSearchChange(value: string) {
    this.search$.next(value);
  }

  private fetchDefault() {
    this.api.dashboard(this.defaultIds).subscribe({
      next: (res: any) => {
        console.log('API response (default)', res);
        this.data = res?.results ?? [];
      },
      error: (err) => {
        console.error('Dashboard API error', err);
        this.data = [];
      }
    });
  }

  private fetchForTerm(term: string) {
    if (!term) {
      this.fetchDefault();
      return;
    }

    // resuelve alias o usa el término directo
    const id = this.alias[term] ?? term.replace(/\s+/g, '-');
    this.api.dashboard([id]).subscribe({
      next: (res: any) => {
        console.log(`API response (${id})`, res);
        this.data = res?.results ?? [];
      },
      error: (err) => {
        console.error('Dashboard API error', err);
        this.data = [];
      }
    });
  }

  openDetail(id: string) {
    this.router.navigate(['/coin', id]);
  }

  pctClass(p: number) {
    return p >= 0 ? 'pct up' : 'pct down';
  }

  fmtPct(p: number) {
    if (p == null) return '—';
    const v = p.toFixed(2);
    return (p >= 0 ? `+${v}` : v) + '%';
  }
}
