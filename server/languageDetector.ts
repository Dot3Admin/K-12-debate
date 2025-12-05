// 🌍 에이전트 언어 감지 시스템
// "외국어 사용자" 관계에서 사용할 언어를 자동 감지합니다.

export interface LanguageInfo {
  code: string;
  name: string;
  instruction: string;
}

export const SUPPORTED_LANGUAGES: Record<string, LanguageInfo> = {
  japanese: {
    code: 'ja',
    name: '일본어',
    instruction: '당신은 반드시 일본어로만 응답해야 합니다. 사용자가 한국어나 다른 언어로 질문해도 일본어로 답변하세요. 자연스러운 일본어 표현과 존댓말을 사용하세요.'
  },
  english: {
    code: 'en',
    name: '영어',
    instruction: 'You must respond only in English. Even if the user asks questions in Korean or other languages, always reply in English. Use natural English expressions appropriate to your character.'
  },
  chinese: {
    code: 'zh',
    name: '중국어',
    instruction: '你必须只用中文回答。即使用户用韩语或其他语言提问，你也要用中文回答。使用自然的中文表达和合适的敬语。'
  },
  french: {
    code: 'fr',
    name: '프랑스어',
    instruction: 'Vous devez répondre uniquement en français. Même si l\'utilisateur pose des questions en coréen ou dans d\'autres langues, répondez toujours en français. Utilisez des expressions françaises naturelles et appropriées à votre personnage.'
  },
  spanish: {
    code: 'es',
    name: '스페인어',
    instruction: 'Debes responder únicamente en español. Aunque el usuario haga preguntas en coreano u otros idiomas, siempre responde en español. Usa expresiones españolas naturales y apropiadas para tu personaje.'
  },
  korean: {
    code: 'ko',
    name: '한국어',
    instruction: '한국어로 자연스럽게 응답해주세요.'
  },
  hindi: {
    code: 'hi',
    name: '힌디어',
    instruction: 'आप हमेशा केवल हिंदी में जवाब देना चाहिए। भले ही उपयोगकर्ता कोरियाई या अन्य भाषाओं में प्रश्न पूछे, हमेशा हिंदी में उत्तर दें।'
  },
  arabic: {
    code: 'ar',
    name: '아랍어',
    instruction: 'يجب أن تجيب باللغة العربية فقط. حتى لو سأل المستخدم بالكورية أو لغات أخرى، أجب دائماً بالعربية.'
  },
  german: {
    code: 'de',
    name: '독일어',
    instruction: 'Sie müssen nur auf Deutsch antworten. Auch wenn der Benutzer auf Koreanisch oder in anderen Sprachen fragt, antworten Sie immer auf Deutsch.'
  },
  italian: {
    code: 'it',
    name: '이탈리아어',
    instruction: 'Devi rispondere solo in italiano. Anche se l\'utente fa domande in coreano o altre lingue, rispondi sempre in italiano.'
  },
  russian: {
    code: 'ru',
    name: '러시아어',
    instruction: 'Вы должны отвечать только на русском языке. Даже если пользователь задает вопросы на корейском или других языках, всегда отвечайте на русском.'
  },
  portuguese: {
    code: 'pt',
    name: '포르투갈어',
    instruction: 'Você deve responder apenas em português. Mesmo que o usuário faça perguntas em coreano ou outros idiomas, sempre responda em português.'
  },
  dutch: {
    code: 'nl',
    name: '네덜란드어',
    instruction: 'Je moet alleen in het Nederlands antwoorden. Ook als de gebruiker vragen stelt in het Koreaans of andere talen, antwoord altijd in het Nederlands.'
  },
  turkish: {
    code: 'tr',
    name: '터키어',
    instruction: 'Sadece Türkçe cevap vermelisiniz. Kullanıcı Korece veya başka dillerde sorular sorsa bile, her zaman Türkçe cevap verin.'
  },
  vietnamese: {
    code: 'vi',
    name: '베트남어',
    instruction: 'Bạn phải chỉ trả lời bằng tiếng Việt. Ngay cả khi người dùng hỏi bằng tiếng Hàn hoặc các ngôn ngữ khác, luôn trả lời bằng tiếng Việt.'
  },
  thai: {
    code: 'th',
    name: '태국어',
    instruction: 'คุณต้องตอบเป็นภาษาไทยเท่านั้น แม้ว่าผู้ใช้จะถามเป็นภาษาเกาหลีหรือภาษาอื่น ให้ตอบเป็นภาษาไทยเสมอ'
  },
  polish: {
    code: 'pl',
    name: '폴란드어',
    instruction: 'Musisz odpowiadać tylko w języku polskim. Nawet jeśli użytkownik zadaje pytania w języku koreańskim lub innych językach, zawsze odpowiadaj po polsku.'
  },
  czech: {
    code: 'cs',
    name: '체코어',
    instruction: 'Musíte odpovídat pouze v češtině. I když uživatel klade otázky v korejštině nebo jiných jazycích, vždy odpovídejte v češtině.'
  },
  greek: {
    code: 'el',
    name: '그리스어',
    instruction: 'Πρέπει να απαντάτε μόνο στα ελληνικά. Ακόμη και αν ο χρήστης κάνει ερωτήσεις στα κορεατικά ή άλλες γλώσσες, απαντήστε πάντα στα ελληνικά.'
  },
  swedish: {
    code: 'sv',
    name: '스웨덴어',
    instruction: 'Du måste bara svara på svenska. Även om användaren ställer frågor på koreanska eller andra språk, svara alltid på svenska.'
  },
  norwegian: {
    code: 'no',
    name: '노르웨이어',
    instruction: 'Du må kun svare på norsk. Selv om brukeren stiller spørsmål på koreansk eller andre språk, svar alltid på norsk.'
  },
  danish: {
    code: 'da',
    name: '덴마크어',
    instruction: 'Du skal kun svare på dansk. Selvom brugeren stiller spørgsmål på koreansk eller andre sprog, svar altid på dansk.'
  },
  finnish: {
    code: 'fi',
    name: '핀란드어',
    instruction: 'Sinun täytyy vastata vain suomeksi. Vaikka käyttäjä kysyisi koreaksi tai muilla kielillä, vastaa aina suomeksi.'
  },
  hungarian: {
    code: 'hu',
    name: '헝가리어',
    instruction: 'Csak magyarul kell válaszolnia. Még akkor is, ha a felhasználó koreai vagy más nyelveken tesz fel kérdéseket, mindig magyarul válaszoljon.'
  },
  romanian: {
    code: 'ro',
    name: '루마니아어',
    instruction: 'Trebuie să răspunzi doar în română. Chiar dacă utilizatorul pune întrebări în coreeană sau alte limbi, răspunde întotdeauna în română.'
  },
  ukrainian: {
    code: 'uk',
    name: '우크라이나어',
    instruction: 'Ви повинні відповідати лише українською мовою. Навіть якщо користувач задає питання корейською або іншими мовами, завжди відповідайте українською.'
  },
  bulgarian: {
    code: 'bg',
    name: '불가리아어',
    instruction: 'Трябва да отговаряте само на български. Дори ако потребителят задава въпроси на корейски или други езици, винаги отговаряйте на български.'
  },
  croatian: {
    code: 'hr',
    name: '크로아티아어',
    instruction: 'Morate odgovarati samo na hrvatskom. Čak i ako korisnik postavlja pitanja na korejskom ili drugim jezicima, uvijek odgovarajte na hrvatskom.'
  },
  serbian: {
    code: 'sr',
    name: '세르비아어',
    instruction: 'Морате одговарати само на српском. Чак и ако корисник поставља питања на корејском или другим језицима, увек одговарајте на српском.'
  },
  slovak: {
    code: 'sk',
    name: '슬로바키아어',
    instruction: 'Musíte odpovedať iba v slovenčine. Aj keď používateľ kladie otázky v kórejčine alebo iných jazykoch, vždy odpovedajte v slovenčine.'
  },
  slovenian: {
    code: 'sl',
    name: '슬로베니아어',
    instruction: 'Odgovarjati morate samo v slovenščini. Tudi če uporabnik postavlja vprašanja v korejščini ali drugih jezikih, vedno odgovarjajte v slovenščini.'
  },
  lithuanian: {
    code: 'lt',
    name: '리투아니아어',
    instruction: 'Turite atsakyti tik lietuviškai. Net jei vartotojas užduoda klausimus korėjiškai ar kitomis kalbomis, visada atsakykite lietuviškai.'
  },
  latvian: {
    code: 'lv',
    name: '라트비아어',
    instruction: 'Jums jāatbild tikai latviešu valodā. Pat ja lietotājs uzdod jautājumus korejiešu vai citās valodās, vienmēr atbildiet latviešu valodā.'
  },
  estonian: {
    code: 'et',
    name: '에스토니아어',
    instruction: 'Te peate vastama ainult eesti keeles. Isegi kui kasutaja küsib korea või teistes keeltes, vastake alati eesti keeles.'
  },
  indonesian: {
    code: 'id',
    name: '인도네시아어',
    instruction: 'Anda harus menjawab hanya dalam Bahasa Indonesia. Meskipun pengguna bertanya dalam bahasa Korea atau bahasa lain, selalu jawab dalam Bahasa Indonesia.'
  },
  malay: {
    code: 'ms',
    name: '말레이어',
    instruction: 'Anda mesti menjawab dalam Bahasa Melayu sahaja. Walaupun pengguna bertanya dalam bahasa Korea atau bahasa lain, sentiasa jawab dalam Bahasa Melayu.'
  },
  filipino: {
    code: 'tl',
    name: '필리핀어',
    instruction: 'Dapat kang sumagot sa Filipino lamang. Kahit magtanong ang user sa Korean o ibang wika, laging sumagot sa Filipino.'
  },
  hebrew: {
    code: 'he',
    name: '히브리어',
    instruction: 'עליך לענות רק בעברית. גם אם המשתמש שואל בקוריאנית או בשפות אחרות, תמיד ענה בעברית.'
  },
  icelandic: {
    code: 'is',
    name: '아이슬란드어',
    instruction: 'Þú verður að svara aðeins á íslensku. Jafnvel þó notandinn spyrji á kóresku eða öðrum tungumálum, svaraðu alltaf á íslensku.'
  },
  maltese: {
    code: 'mt',
    name: '몰타어',
    instruction: 'Trid tweġib bil-Malti biss. Anke jekk l-utent jistaqsi bil-Korean jew lingwi oħra, dejjem tweġib bil-Malti.'
  }
};

/**
 * 에이전트 이름과 설명을 분석해서 언어를 감지합니다.
 */
export function detectAgentLanguage(agentName: string, description: string = ''): string {
  const searchText = `${agentName} ${description}`.toLowerCase();
  
  console.log(`[언어 감지 디버그] 에이전트="${agentName}", 설명="${description}", 검색텍스트="${searchText}"`);
  
  // 일본어 키워드 감지
  const japaneseKeywords = [
    '일본', 'japan', 'japanese', '스타벅스', 'starbucks', '도쿄', 'tokyo', 
    '오사카', 'osaka', '교토', 'kyoto', '일본어', '바리스타', '초밥', 'sushi',
    '라멘', 'ramen', '사케', 'sake', '닌자', 'ninja', '사무라이', 'samurai',
    '아니메', 'anime', '망가', 'manga', 'yen', '엔화', 'jpn'
  ];
  
  // 영어 키워드 감지
  const englishKeywords = [
    '해리포터', '해리 포터', '헤리포터', '헤리 포터', 'harry potter', 'harry', 'potter', '영국', 'britain', 'uk', 'england', 'london',
    '미국', 'america', 'usa', 'united states', '영어', 'english', 'shakespeare',
    '셜록홈즈', '셜록 홈즈', 'sherlock holmes', '스타벅스', 'starbucks', '맥도날드', 'mcdonald',
    'disney', '디즈니', 'marvel', '마블', 'netflix', '넷플릭스', 'hogwarts', '호그와트',
    'wizard', '마법사', 'magic', '마법', 'dumbledore', '덤블도어', 'hermione', '헤르미온느',
    '워런', '버핏', 'warren', 'buffett', 'berkshire', '버크셔', 'wall street', '월스트리트',
    'omaha', '오마하', 'investment', '투자', 'oracle', '오라클'
  ];
  
  // 중국어 키워드 감지
  const chineseKeywords = [
    '중국', 'china', 'chinese', '베이징', 'beijing', '상하이', 'shanghai',
    '홍콩', 'hong kong', '대만', 'taiwan', '중국어', '만다린', 'mandarin',
    '광둥', 'canton', '위안화', 'yuan', 'rmb', 'chn', '공자', 'confucius'
  ];

  // 프랑스어 키워드 감지
  const frenchKeywords = [
    '프랑스', 'france', 'french', 'français', '파리', 'paris', '프랑스어',
    '자크', 'jacques', '르블랑', 'leblanc', 'le blanc', '프랑스인',
    '리옹', 'lyon', '마르세유', 'marseille', '니스', 'nice', '칸', 'cannes',
    '보르도', 'bordeaux', '프랑', 'franc', 'baguette', '바게트', 
    'croissant', '크루아상', 'fromage', '치즈', 'vin', '와인',
    'bonjour', '봉주르', 'merci', '메르시', 'château', '샤토'
  ];

  // 스페인어 키워드 감지
  const spanishKeywords = [
    '스페인', 'spain', 'spanish', 'español', '마드리드', 'madrid', '스페인어',
    '파블로', 'pablo', '피카소', 'picasso', '스페인인', '바르셀로나', 'barcelona',
    '세비야', 'seville', '발렌시아', 'valencia', '빌바오', 'bilbao',
    '그라나다', 'granada', '말라가', 'malaga', '플라멩코', 'flamenco',
    'hola', '올라', 'gracias', '그라시아스', 'tapas', '타파스',
    'paella', '파에야', 'siesta', '시에스타', 'fiesta', '피에스타'
  ];

  // 독일어 키워드 감지
  const germanKeywords = [
    '독일', 'germany', 'german', 'deutsch', '베를린', 'berlin', '독일어',
    '뮌헨', 'munich', '함부르크', 'hamburg', '프랑크푸르트', 'frankfurt',
    '쾰른', 'cologne', '슈투트가르트', 'stuttgart', 'guten tag', '구텐 탁',
    'danke', '단케', 'bitte', '비테', '옥토버페스트', 'oktoberfest',
    '바이에른', 'bavaria', 'bratwurst', '브라트부르스트'
  ];

  // 이탈리아어 키워드 감지
  const italianKeywords = [
    '이탈리아', 'italy', 'italian', 'italiano', '로마', 'rome', '이탈리아어',
    '밀라노', 'milan', '베니스', 'venice', '피렌체', 'florence', '나폴리', 'naples',
    'ciao', '치아오', 'grazie', '그라찌에', 'prego', '프레고',
    'pizza', '피자', 'pasta', '파스타', 'gelato', '젤라토'
  ];

  // 러시아어 키워드 감지
  const russianKeywords = [
    '러시아', 'russia', 'russian', 'русский', '모스크바', 'moscow', '러시아어',
    '상트페테르부르크', 'petersburg', '볼가', 'volga', '시베리아', 'siberia',
    'привет', '프리베트', 'спасибо', '스파시보', '보드카', 'vodka',
    '크렘린', 'kremlin', '우랄', 'ural'
  ];

  // 포르투갈어 키워드 감지
  const portugueseKeywords = [
    '포르투갈', 'portugal', 'portuguese', 'português', '브라질', 'brazil', '포르투갈어',
    '리스본', 'lisbon', '포르토', 'porto', '상파울루', 'sao paulo', '리우', 'rio',
    'olá', '올라', 'obrigado', '오브리가도', 'fado', '파두',
    '브라질리아', 'brasilia', '아마존', 'amazon'
  ];

  // 힌디어/인도어 키워드 감지  
  const hindiKeywords = [
    '인도', 'india', 'hindi', 'हिंदी', '뉴델리', 'delhi', '힌디어', '인도어',
    '뭄바이', 'mumbai', '콜카타', 'kolkata', '첸나이', 'chennai', '방갈로르', 'bangalore',
    'namaste', '나마스테', '간디', 'gandhi', '인디라', 'indira', '네루', 'nehru',
    '볼리우드', 'bollywood', '타지마할', 'taj mahal', '카레', 'curry'
  ];

  // 아랍어 키워드 감지
  const arabicKeywords = [
    '아랍', 'arab', 'arabic', 'العربية', '사우디', 'saudi', '아랍어',
    '두바이', 'dubai', '아부다비', 'abu dhabi', '리야드', 'riyadh', '카이로', 'cairo',
    'salam', '살람', 'shukran', '슈크란', '이슬람', 'islam',
    '메카', 'mecca', '메디나', 'medina'
  ];

  // 네덜란드어 키워드 감지
  const dutchKeywords = [
    '네덜란드', 'netherlands', 'dutch', 'nederlands', '암스테르담', 'amsterdam', '네덜란드어',
    '헤이그', 'hague', '로테르담', 'rotterdam', 'hallo', '할로',
    'dank je', '단크 예', '튤립', 'tulip', '풍차', 'windmill'
  ];

  // 터키어 키워드 감지
  const turkishKeywords = [
    '터키', 'turkey', 'turkish', 'türkçe', '이스탄불', 'istanbul', '터키어',
    '앙카라', 'ankara', '이즈미르', 'izmir', 'merhaba', '메르하바',
    'teşekkür', '테셰쿠르', '케밥', 'kebab', '보스포루스', 'bosphorus'
  ];

  // 베트남어 키워드 감지
  const vietnameseKeywords = [
    '베트남', 'vietnam', 'vietnamese', 'tiếng việt', '하노이', 'hanoi', '베트남어',
    '호치민', 'ho chi minh', '사이공', 'saigon', '다낭', 'danang',
    'xin chào', '신 차오', 'cảm ơn', '캄 언', '포', 'pho'
  ];

  // 태국어 키워드 감지
  const thaiKeywords = [
    '태국', 'thailand', 'thai', 'ไทย', '방콕', 'bangkok', '태국어',
    '치앙마이', 'chiang mai', '푸켓', 'phuket', 'sawasdee', '사와디',
    'khob khun', '코프 쿤', '톰얌', 'tom yum', '팟타이', 'pad thai'
  ];

  // 폴란드어 키워드 감지
  const polishKeywords = [
    '폴란드', 'poland', 'polish', 'polski', '바르샤바', 'warsaw', '폴란드어',
    '크라쿠프', 'krakow', '그단스크', 'gdansk', 'dzień dobry', '제인 도브리',
    'dziękuję', '제쿠예', '피에로기', 'pierogi'
  ];

  // 체코어 키워드 감지
  const czechKeywords = [
    '체코', 'czech', 'čeština', '프라하', 'prague', '체코어',
    '브르노', 'brno', 'dobrý den', '도브리 덴', 'děkuji', '데쿠이',
    '필젠', 'pilsen', '보헤미아', 'bohemia'
  ];

  // 그리스어 키워드 감지
  const greekKeywords = [
    '그리스', 'greece', 'greek', 'ελληνικά', '아테네', 'athens', '그리스어',
    '테살로니키', 'thessaloniki', '산토리니', 'santorini', '미코노스', 'mykonos',
    'γεια σας', '야 사스', 'ευχαριστώ', '에프하리스토'
  ];

  // 스웨덴어 키워드 감지
  const swedishKeywords = [
    '스웨덴', 'sweden', 'swedish', 'svenska', '스톡홀름', 'stockholm', '스웨덴어',
    '예테보리', 'gothenburg', '말뫼', 'malmo', 'hej', '헤이',
    'tack', '탁', '이케아', 'ikea', '볼보', 'volvo'
  ];

  // 노르웨이어 키워드 감지
  const norwegianKeywords = [
    '노르웨이', 'norway', 'norwegian', 'norsk', '오슬로', 'oslo', '노르웨이어',
    '베르겐', 'bergen', '트론헤임', 'trondheim', 'hei', '헤이',
    'takk', '탁', '피오르드', 'fjord'
  ];

  // 덴마크어 키워드 감지
  const danishKeywords = [
    '덴마크', 'denmark', 'danish', 'dansk', '코펜하겐', 'copenhagen', '덴마크어',
    '오르후스', 'aarhus', '오덴세', 'odense', 'hej', '헤이',
    'tak', '탁', '레고', 'lego', '안데르센', 'andersen'
  ];

  // 핀란드어 키워드 감지
  const finnishKeywords = [
    '핀란드', 'finland', 'finnish', 'suomi', '헬싱키', 'helsinki', '핀란드어',
    '탐페레', 'tampere', '투르쿠', 'turku', 'hei', '헤이',
    'kiitos', '키토스', '사우나', 'sauna', '노키아', 'nokia'
  ];

  // 헝가리어 키워드 감지
  const hungarianKeywords = [
    '헝가리', 'hungary', 'hungarian', 'magyar', '부다페스트', 'budapest', '헝가리어',
    '데브레첸', 'debrecen', '세게드', 'szeged', 'jó napot', '요 나포트',
    'köszönöm', '쾨쇠뇸', '굴라시', 'goulash'
  ];

  // 루마니아어 키워드 감지
  const romanianKeywords = [
    '루마니아', 'romania', 'romanian', 'română', '부쿠레슈티', 'bucharest', '루마니아어',
    '클루지', 'cluj', '콘스탄차', 'constanta', 'bună ziua', '부나 지우아',
    'mulțumesc', '물추메스크', '드라큘라', 'dracula'
  ];

  // 우크라이나어 키워드 감지
  const ukrainianKeywords = [
    '우크라이나', 'ukraine', 'ukrainian', 'українська', '키예프', 'kyiv', '우크라이나어',
    '하르키우', 'kharkiv', '리비우', 'lviv', '오데사', 'odessa',
    'привіт', '프리비트', 'дякую', '댜쿠유'
  ];

  // 불가리아어 키워드 감지
  const bulgarianKeywords = [
    '불가리아', 'bulgaria', 'bulgarian', 'български', '소피아', 'sofia', '불가리아어',
    '플로브디프', 'plovdiv', '바르나', 'varna', 'здравейте', '즈드라베이테',
    'благодаря', '블라고다랴'
  ];

  // 크로아티아어 키워드 감지
  const croatianKeywords = [
    '크로아티아', 'croatia', 'croatian', 'hrvatski', '자그레브', 'zagreb', '크로아티아어',
    '스플리트', 'split', '두브로브니크', 'dubrovnik', 'bok', '보크',
    'hvala', '흐발라', '달마티아', 'dalmatia'
  ];

  // 세르비아어 키워드 감지
  const serbianKeywords = [
    '세르비아', 'serbia', 'serbian', 'српски', '베오그라드', 'belgrade', '세르비아어',
    '노비사드', 'novi sad', '니시', 'nis', 'здраво', '즈드라보',
    'хвала', '흐발라'
  ];

  // 슬로바키아어 키워드 감지
  const slovakKeywords = [
    '슬로바키아', 'slovakia', 'slovak', 'slovenčina', '브라티슬라바', 'bratislava', '슬로바키아어',
    '코시체', 'kosice', '프레쇼프', 'presov', 'dobrý deň', '도브리 덴',
    'ďakujem', '댜쿠옘'
  ];

  // 슬로베니아어 키워드 감지
  const slovenianKeywords = [
    '슬로베니아', 'slovenia', 'slovenian', 'slovenščina', '류블랴나', 'ljubljana', '슬로베니아어',
    '마리보르', 'maribor', '첼레', 'celje', 'dober dan', '도베르 단',
    'hvala', '흐발라'
  ];

  // 리투아니아어 키워드 감지
  const lithuanianKeywords = [
    '리투아니아', 'lithuania', 'lithuanian', 'lietuvių', '빌뉴스', 'vilnius', '리투아니아어',
    '카우나스', 'kaunas', '클라이페다', 'klaipeda', 'labas', '라바스',
    'ačiū', '아치우'
  ];

  // 라트비아어 키워드 감지
  const latvianKeywords = [
    '라트비아', 'latvia', 'latvian', 'latviešu', '리가', 'riga', '라트비아어',
    '다우가브필스', 'daugavpils', '리에파야', 'liepaja', 'sveiki', '스베이키',
    'paldies', '팔디에스'
  ];

  // 에스토니아어 키워드 감지
  const estonianKeywords = [
    '에스토니아', 'estonia', 'estonian', 'eesti', '탈린', 'tallinn', '에스토니아어',
    '타르투', 'tartu', '나르바', 'narva', 'tere', '테레',
    'tänan', '태난'
  ];

  // 인도네시아어 키워드 감지
  const indonesianKeywords = [
    '인도네시아', 'indonesia', 'indonesian', 'bahasa indonesia', '자카르타', 'jakarta', '인도네시아어',
    '수라바야', 'surabaya', '반둥', 'bandung', '발리', 'bali',
    'halo', '할로', 'terima kasih', '테리마 카시', '나시고렝', 'nasi goreng'
  ];

  // 말레이어 키워드 감지
  const malayKeywords = [
    '말레이시아', 'malaysia', 'malay', 'bahasa melayu', '쿠알라룸푸르', 'kuala lumpur', '말레이어',
    '조호르', 'johor', '페낭', 'penang', '사바', 'sabah', '사라왁', 'sarawak',
    'hello', '헬로', 'terima kasih', '테리마 카시'
  ];

  // 필리핀어 키워드 감지
  const filipinoKeywords = [
    '필리핀', 'philippines', 'filipino', 'tagalog', '마닐라', 'manila', '필리핀어',
    '세부', 'cebu', '다바오', 'davao', '보라카이', 'boracay',
    'kumusta', '쿠무스타', 'salamat', '살라맷', '아도보', 'adobo'
  ];

  // 히브리어 키워드 감지
  const hebrewKeywords = [
    '이스라엘', 'israel', 'hebrew', 'עברית', '예루살렘', 'jerusalem', '히브리어',
    '텔아비브', 'tel aviv', '하이파', 'haifa', 'shalom', '샬롬',
    'toda', '토다', '유대인', 'jewish'
  ];

  // 아이슬란드어 키워드 감지
  const icelandicKeywords = [
    '아이슬란드', 'iceland', 'icelandic', 'íslenska', '레이캬비크', 'reykjavik', '아이슬란드어',
    '게이시르', 'geysir', '아쿠레이리', 'akureyri', 'halló', '할로',
    'takk', '탁', '비요크', 'bjork'
  ];

  // 몰타어 키워드 감지
  const malteseKeywords = [
    '몰타', 'malta', 'maltese', 'malti', '발레타', 'valletta', '몰타어',
    '슬리에마', 'sliema', '골든베이', 'golden bay', 'bonġu', '본주',
    'grazzi', '그라찌'
  ];

  // 키워드 매칭으로 언어 감지 (우선순위 높은 언어부터)
  if (hindiKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 힌디어 키워드 매칭됨: ${hindiKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'hindi';
  }
  
  if (arabicKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 아랍어 키워드 매칭됨: ${arabicKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'arabic';
  }
  
  if (germanKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 독일어 키워드 매칭됨: ${germanKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'german';
  }
  
  if (italianKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 이탈리아어 키워드 매칭됨: ${italianKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'italian';
  }
  
  if (russianKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 러시아어 키워드 매칭됨: ${russianKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'russian';
  }
  
  if (portugueseKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 포르투갈어 키워드 매칭됨: ${portugueseKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'portuguese';
  }
  
  if (dutchKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 네덜란드어 키워드 매칭됨: ${dutchKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'dutch';
  }
  
  if (turkishKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 터키어 키워드 매칭됨: ${turkishKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'turkish';
  }
  
  if (vietnameseKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 베트남어 키워드 매칭됨: ${vietnameseKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'vietnamese';
  }
  
  if (thaiKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 태국어 키워드 매칭됨: ${thaiKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'thai';
  }
  
  if (polishKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 폴란드어 키워드 매칭됨: ${polishKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'polish';
  }
  
  if (czechKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 체코어 키워드 매칭됨: ${czechKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'czech';
  }
  
  if (greekKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 그리스어 키워드 매칭됨: ${greekKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'greek';
  }
  
  if (swedishKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 스웨덴어 키워드 매칭됨: ${swedishKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'swedish';
  }
  
  if (norwegianKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 노르웨이어 키워드 매칭됨: ${norwegianKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'norwegian';
  }
  
  if (danishKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 덴마크어 키워드 매칭됨: ${danishKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'danish';
  }
  
  if (finnishKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 핀란드어 키워드 매칭됨: ${finnishKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'finnish';
  }
  
  if (hungarianKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 헝가리어 키워드 매칭됨: ${hungarianKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'hungarian';
  }
  
  if (romanianKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 루마니아어 키워드 매칭됨: ${romanianKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'romanian';
  }
  
  if (ukrainianKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 우크라이나어 키워드 매칭됨: ${ukrainianKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'ukrainian';
  }
  
  if (bulgarianKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 불가리아어 키워드 매칭됨: ${bulgarianKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'bulgarian';
  }
  
  if (croatianKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 크로아티아어 키워드 매칭됨: ${croatianKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'croatian';
  }
  
  if (serbianKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 세르비아어 키워드 매칭됨: ${serbianKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'serbian';
  }
  
  if (slovakKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 슬로바키아어 키워드 매칭됨: ${slovakKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'slovak';
  }
  
  if (slovenianKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 슬로베니아어 키워드 매칭됨: ${slovenianKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'slovenian';
  }
  
  if (lithuanianKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 리투아니아어 키워드 매칭됨: ${lithuanianKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'lithuanian';
  }
  
  if (latvianKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 라트비아어 키워드 매칭됨: ${latvianKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'latvian';
  }
  
  if (estonianKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 에스토니아어 키워드 매칭됨: ${estonianKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'estonian';
  }
  
  if (indonesianKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 인도네시아어 키워드 매칭됨: ${indonesianKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'indonesian';
  }
  
  if (malayKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 말레이어 키워드 매칭됨: ${malayKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'malay';
  }
  
  if (filipinoKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 필리핀어 키워드 매칭됨: ${filipinoKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'filipino';
  }
  
  if (hebrewKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 히브리어 키워드 매칭됨: ${hebrewKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'hebrew';
  }
  
  if (icelandicKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 아이슬란드어 키워드 매칭됨: ${icelandicKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'icelandic';
  }
  
  if (malteseKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 몰타어 키워드 매칭됨: ${malteseKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'maltese';
  }

  // 기존 언어들
  if (japaneseKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 일본어 키워드 매칭됨: ${japaneseKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'japanese';
  }
  
  if (englishKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 영어 키워드 매칭됨: ${englishKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'english';
  }
  
  if (chineseKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 중국어 키워드 매칭됨: ${chineseKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'chinese';
  }
  
  if (frenchKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 프랑스어 키워드 매칭됨: ${frenchKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'french';
  }
  
  if (spanishKeywords.some(keyword => searchText.includes(keyword))) {
    console.log(`[언어 감지 디버그] 스페인어 키워드 매칭됨: ${spanishKeywords.filter(k => searchText.includes(k)).join(', ')}`);
    return 'spanish';
  }
  
  console.log(`[언어 감지 디버그] 매칭된 키워드 없음, 기본값 'korean' 반환`);
  // 기본값은 한국어
  return 'korean';
}

/**
 * 특정 언어에 대한 OpenAI 지시문을 생성합니다.
 */
export function generateLanguageInstruction(language: string): string {
  const languageInfo = SUPPORTED_LANGUAGES[language];
  if (!languageInfo) {
    return SUPPORTED_LANGUAGES.korean.instruction;
  }
  
  return `**🌍 언어 지시사항:**
${languageInfo.instruction}

**주의사항:**
- 캐릭터의 고유한 특성은 유지하되, 언어만 ${languageInfo.name}로 고정하세요.
- 문화적 배경에 맞는 자연스러운 표현을 사용하세요.
- 사용자의 질문 언어와 상관없이 항상 ${languageInfo.name}로만 응답하세요.`;
}

/**
 * "모국어 사용" 관계인지 확인합니다.
 */
export function isForeignLanguageRelationship(relationshipType: string): boolean {
  return relationshipType === "모국어 사용";
}

/**
 * 에이전트의 언어 정보를 종합적으로 분석합니다.
 */
export function analyzeAgentLanguage(
  agentName: string, 
  description: string = '', 
  relationshipType: string = '친구'
): {
  shouldUseNativeLanguage: boolean;
  detectedLanguage: string;
  languageInstruction: string;
} {
  const shouldUse = isForeignLanguageRelationship(relationshipType);
  const language = shouldUse ? detectAgentLanguage(agentName, description) : 'korean';
  const instruction = shouldUse ? generateLanguageInstruction(language) : '';
  
  return {
    shouldUseNativeLanguage: shouldUse,
    detectedLanguage: language,
    languageInstruction: instruction
  };
}

/**
 * 🌍 언어 키를 한국어 이름으로 변환하는 헬퍼 함수
 */
export function getLanguageName(languageKey: string): string {
  const languageInfo = SUPPORTED_LANGUAGES[languageKey];
  return languageInfo ? languageInfo.name : languageKey;
}

/**
 * 🌍 언어명을 BCP-47 코드로 변환하는 헬퍼 함수
 * generateSmartFallbackResponse와 generateChatResponse가 기대하는 형식으로 변환
 */
export function getLangCode(languageKey: string): string {
  switch (languageKey) {
    case 'english': return 'en';
    case 'japanese': return 'ja';
    case 'chinese': return 'zh';
    case 'french': return 'fr';
    case 'spanish': return 'es';
    case 'korean': return 'ko';
    case 'hindi': return 'hi';
    case 'arabic': return 'ar';
    case 'german': return 'de';
    case 'italian': return 'it';
    case 'russian': return 'ru';
    case 'portuguese': return 'pt';
    case 'dutch': return 'nl';
    case 'turkish': return 'tr';
    case 'vietnamese': return 'vi';
    case 'thai': return 'th';
    case 'polish': return 'pl';
    case 'czech': return 'cs';
    case 'greek': return 'el';
    case 'swedish': return 'sv';
    case 'norwegian': return 'no';
    case 'danish': return 'da';
    case 'finnish': return 'fi';
    case 'hungarian': return 'hu';
    case 'romanian': return 'ro';
    case 'ukrainian': return 'uk';
    case 'bulgarian': return 'bg';
    case 'croatian': return 'hr';
    case 'serbian': return 'sr';
    case 'slovak': return 'sk';
    case 'slovenian': return 'sl';
    case 'lithuanian': return 'lt';
    case 'latvian': return 'lv';
    case 'estonian': return 'et';
    case 'indonesian': return 'id';
    case 'malay': return 'ms';
    case 'filipino': return 'tl';
    case 'hebrew': return 'he';
    case 'icelandic': return 'is';
    case 'maltese': return 'mt';
    default: return 'ko'; // 기본값
  }
}