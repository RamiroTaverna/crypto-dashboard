import { TestBed } from '@angular/core/testing';

import { Market } from './market';

describe('Market', () => {
  let service: Market;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Market);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
