import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MarketService } from '../../../../core/services/market/market.service';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';

@Component({
  selector: 'app-coin-detail-page',
  standalone: true,
  imports: [CommonModule, BaseChartDirective],
  templateUrl: './coin-detail-page.component.html', // 👈 correcto
  styleUrls: ['./coin-detail-page.component.scss']
})
export class CoinDetailPageComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private api = inject(MarketService);

  id = '';
  days = 90;

  chartData: ChartConfiguration<'line'>['data'] = {
    labels: [],
    datasets: [{ data: [], label: 'Precio' }]
  };

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.load();
  }

  load() {
    this.api.history(this.id, this.days, 'daily').subscribe((d: any) => {
      const prices: [number, number][] = d?.prices ?? [];
      this.chartData = {
        labels: prices.map(p => new Date(p[0]).toLocaleDateString()),
        datasets: [{ data: prices.map(p => p[1]), label: `${this.id.toUpperCase()} (USD)` }]
      };
    });
  }
}
