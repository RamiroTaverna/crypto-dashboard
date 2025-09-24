import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CoinDetailPage } from './coin-detail-page';

describe('CoinDetailPage', () => {
  let component: CoinDetailPage;
  let fixture: ComponentFixture<CoinDetailPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CoinDetailPage]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CoinDetailPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
