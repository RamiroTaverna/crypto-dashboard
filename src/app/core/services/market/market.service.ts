import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class MarketService {
  private http = inject(HttpClient);
  private base = 'http://localhost:3000/api';


  dashboard(ids: string[]) {
    const q = encodeURIComponent(ids.join(','));
    // 👇 OJO: no pongas espacios raros; esto es un genérico de TypeScript
    return this.http.get<{ count: number; results: any[] }>(
      `${this.base}/dashboard?ids=${q}`
    );
  }

  history(id: string, days = 90, interval: 'daily' | 'hourly' | 'weekly' = 'daily') {
    return this.http.get<any>(
      `${this.base}/coin/${id}/history?days=${days}&interval=${interval}`
    );
  }
}
