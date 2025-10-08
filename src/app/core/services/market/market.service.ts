import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class MarketService {
  private http = inject(HttpClient);

  // ✅ en producción, siempre relativo al mismo dominio
  private base = '/api';

  dashboard(ids: string[]) {
    return this.http.get<{count:number; results:any[]}>(
      `${this.base}/dashboard?ids=${ids.join(',')}`
    );
  }

  history(id: string, days = 90, interval: 'daily'|'hourly'|'weekly' = 'daily') {
    return this.http.get<any>(
      `${this.base}/coin/${id}/history?days=${days}&interval=${interval}`
    );
  }
}
