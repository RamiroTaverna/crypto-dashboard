import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Sparkline } from './sparkline';

describe('Sparkline', () => {
  let component: Sparkline;
  let fixture: ComponentFixture<Sparkline>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Sparkline]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Sparkline);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
