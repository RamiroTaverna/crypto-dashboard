import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartOptions } from 'chart.js';

@Component({
  selector: 'app-sparkline',
  standalone: true,
  imports: [CommonModule, BaseChartDirective],
  templateUrl: './sparkline.component.html',
  styleUrls: ['./sparkline.component.scss']
})
export class SparklineComponent {
  @Input() data: number[] = [];

  get chartData(): ChartConfiguration<'line'>['data'] {
    return {
      labels: this.data.map((_, i) => i),
      datasets: [{ data: this.data, borderWidth: 1, tension: 0.3, pointRadius: 0 }]
    };
  }

  options: ChartOptions<'line'> = {
    responsive: true,
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    elements: { line: { borderWidth: 1 }, point: { radius: 0 } },
    scales: { x: { display: false }, y: { display: false } }
  };
}
