import {
  extractPartitions,
  findAbsenceInferences,
  findStudyScopeAbsenceClaims,
  splitSentences,
} from '../../../src/common/text/evidence-grounding';
import { NINE_OF_TEN_ABSTRACT } from '../../fixtures/nine-of-ten.fixture';

describe('evidence grounding: no conclusions from unreported data', () => {
  it('finds "k of n" partitions in English and Turkish sources', () => {
    expect(extractPartitions(NINE_OF_TEN_ABSTRACT)).toEqual([{ k: 9, n: 10 }]);
    expect(extractPartitions('improves accuracy in 3 of the 4 benchmarks')).toEqual([
      { k: 3, n: 4 },
    ]);
    expect(extractPartitions('on kombinasyonun dokuzunda hata azaldı')).toEqual([{ k: 9, n: 10 }]);
    expect(extractPartitions("10 kombinasyondan 9'unda hata azaldı")).toEqual([{ k: 9, n: 10 }]);
    expect(extractPartitions('seventeen of twenty runs')).toEqual([{ k: 17, n: 20 }]);
    expect(extractPartitions('one of the most robust methods; 15–60% lower RMSE')).toEqual([]);
  });

  describe('the first published issue (2026-11-26): 9 of 10 combinations', () => {
    const rejected = [
      'Onuncu kombinasyonda ise herhangi bir iyileşme görülmedi.',
      'Onuncu kombinasyon iyileşme göstermedi.',
      '10. kombinasyonda yöntem başarısız oldu.',
      'Dokuzunda hata %15–60 azalırken birinde ise iyileşme olmadı.',
      'Geri kalan kombinasyonda performans düştü.',
      'Kalan bir kombinasyonda yöntem işe yaramadı.',
      'Kalan kombinasyonda hata arttı.',
      'The tenth combination showed no improvement.',
      'The remaining combination performed worse.',
    ];
    const accepted = [
      'Yazarlar, değerlendirilen on kombinasyonun dokuzunda konum RMSE değerinin %15–60 azaldığını bildiriyor.',
      'Onuncu kombinasyonun sonucu özette belirtilmiyor.',
      'Kalan bir kombinasyonda ne olduğu özette açıklanmıyor; bu nedenle yöntemin her koşulda işe yaradığı söylenemez.',
      'Geri kalan kombinasyonun sonucu bilinmiyor.',
      'The result for the remaining combination is not reported in the abstract.',
      'Açık kalan sorularda daha fazla deney gerekiyor.',
      'Diğer bir deyişle, öğrenilen model fizik tabanlı modeli tamamlıyor.',
    ];

    it.each(rejected)('rejects: %s', (sentence) => {
      expect(findAbsenceInferences([sentence], NINE_OF_TEN_ABSTRACT)).toEqual([
        { partition: '9/10', sentence },
      ]);
    });

    it.each(accepted)('accepts: %s', (sentence) => {
      expect(findAbsenceInferences([sentence], NINE_OF_TEN_ABSTRACT)).toEqual([]);
    });
  });

  it('allows statements about the remainder when the source itself describes it', () => {
    const source = `${NINE_OF_TEN_ABSTRACT} In the remaining combination the error increased slightly.`;
    expect(findAbsenceInferences(['Onuncu kombinasyonda hata biraz arttı.'], source)).toEqual([]);
  });

  it('is inactive when the source reports no partition', () => {
    const source = 'We reduce position RMSE by 15–60% on two platforms.';
    expect(findAbsenceInferences(['Onuncu deneme başarısız oldu.'], source)).toEqual([]);
  });

  it('does not split sentences after ordinals or decimals', () => {
    expect(splitSentences('10. kombinasyonda 0.5 puan düştü. Sonra durdu.')).toEqual([
      '10. kombinasyonda 0.5 puan düştü.',
      'Sonra durdu.',
    ]);
  });
});

describe('abstract-only scope: absence in the abstract is not absence in the study', () => {
  // The sentence from the 2026-11-28 issue, and its correct form.
  const PUBLISHED = 'Simülasyondan gerçek robota aktarım bu çalışmada ele alınmıyor.';
  const CORRECT = 'Simülasyondan gerçek robota aktarım özette ele alınmıyor.';

  it.each([
    PUBLISHED,
    'Simülasyondan gerçek robota aktarım ele alınmıyor.',
    'Yazarlar yöntemi gerçek bir robotta test etmiyor.',
    'Makale gerçek dünya deneyleri içermiyor.',
    'Çalışma açık kaynak kod sunmuyor.',
    'Yöntem gerçek donanımda doğrulanmamış.',
    'Gerçek robot deneyi yapılmamış.',
    'Farklı tutucularla karşılaştırma yapılmıyor.',
    'Uzun süreli kullanım incelenmiyor.',
    'Çalışma hesaplama maliyetini bildirmiyor.',
    'İnsanlarla etkileşim çalışmada değerlendirilmiyor.',
  ])('flags %j', (sentence) => {
    expect(findStudyScopeAbsenceClaims([sentence])).toEqual([sentence]);
  });

  it.each([
    CORRECT,
    'Gerçek robot deneyleri özette yer almıyor.',
    'Özete göre yöntem gerçek donanımda test edilmemiş.',
    'Yazarlar gerçek robotta test etmediklerini belirtiyor.',
    'Gerçek robotta test edilip edilmediği bilinmiyor.',
    'Hesaplama maliyeti belirtilmiyor.', // reporting verb without the study as subject
    'Kalan bir kombinasyonun sonucu özette belirtilmiyor.',
    'Sonuçlar, yöntemin her koşulda çalıştığını göstermiyor.', // epistemic, about evidence
    'Bu bulgu genellemeyi doğrulamıyor.',
    'Yöntem etiketli veri gerektirmiyor.',
    'Tam metin, şekiller ve tablolar incelenmedi.', // about what PaperMorning read
    'PaperMorning tam metni değerlendirmedi.',
    'Sistem insan müdahalesi içermiyor.', // a property of the method, not of the study
    'Model temas kuvvetini ölçmüyor.',
    'Yazarlar başarı oranında belirgin bir artış bildiriyor.',
  ])('allows %j', (sentence) => {
    expect(findStudyScopeAbsenceClaims([sentence])).toEqual([]);
  });

  it('checks every sentence of a paragraph and returns only the offending one', () => {
    expect(
      findStudyScopeAbsenceClaims([`Yazarlar %35 tasarruf bildiriyor. ${PUBLISHED} ${CORRECT}`]),
    ).toEqual([PUBLISHED]);
  });
});
