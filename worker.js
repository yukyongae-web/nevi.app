// ==========================================
// [운영자 설정 영역]
// 아래 DAILY_LIMIT 값을 변경하여 하루 무료 질문 횟수를 조절할 수 있습니다.
const DAILY_LIMIT = 1;
// ==========================================

// Cloudflare Workers KV 미바인딩 시 로컬 시뮬레이션을 위한 인메모리 캐시 맵
const localCache = new Map();

export default {
  async fetch(request, env, ctx) {
    // 요청자 Origin 파악 및 CORS 템플릿 설정 (동적 Origin Echo 지원)
    const requestOrigin = request.headers.get("Origin") || "*";
    const corsHeaders = {
      "Access-Control-Allow-Origin": requestOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Content-Type": "application/json"
    };

    // 1. CORS 프리플라이트 처리
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders
      });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Post method required" }), {
        status: 405,
        headers: corsHeaders
      });
    }

    try {
      // 2. 요청 바디 데이터 파싱
      const body = await request.json();
      const { direction, interest, time, mood, prevResult, prevReason, deviceId } = body;

      // deviceId가 없으면 빈 문자열 혹은 임의 문자열로 대체하여 비정상 차단 예방
      const finalDeviceId = deviceId || "unknown_device";

      // 3. 접속자 IP 식별
      const ip = request.headers.get("CF-Connecting-IP") || "unknown_ip";

      // 4. 한국 표준시(KST, UTC+9) 기준으로 오늘 날짜 YYYY-MM-DD 구하기
      const now = new Date();
      const kstTime = new Date(now.getTime() + (9 * 60 * 60 * 1000));
      const dateString = kstTime.toISOString().split("T")[0];

      // KV 네임스페이스 바인딩 이름 정의: env.NEVI_LIMITS
      const kv = env.NEVI_LIMITS;

      // 5. IP 및 Device ID 카운트 조회
      let ipKey = `limit:ip:${ip}:${dateString}`;
      let devKey = `limit:device:${finalDeviceId}:${dateString}`;

      let ipCount = 0;
      let devCount = 0;

      if (kv) {
        // Cloudflare KV 사용 시
        ipCount = parseInt(await kv.get(ipKey) || "0", 10);
        devCount = parseInt(await kv.get(devKey) || "0", 10);
      } else {
        // KV가 설정되지 않았을 경우, 글로벌 인메모리 맵 사용
        ipCount = localCache.get(ipKey) || 0;
        devCount = localCache.get(devKey) || 0;
      }

      // 6. 하루 호출 한도 초과 체크 (IP 또는 Device ID 중 하나라도 초과 시 차단, 로컬호스트 환경은 디버깅을 위해 제외)
      const isLocalhost = ip === "127.0.0.1" || ip === "::1" || ip === "unknown_ip" || ip.startsWith("localhost");
      if (!isLocalhost && (ipCount >= DAILY_LIMIT || devCount >= DAILY_LIMIT)) {
        return new Response(
          JSON.stringify({ error: "오늘의 무료 질문은 끝났습니다. 내일 다시 와주세요!" }),
          {
            status: 429,
            headers: corsHeaders
          }
        );
      }

      // 7. 한도 내인 경우 카운트 1 증가 후 저장
      if (kv) {
        // KV 스토리지 갱신 (하루 단위 보관이므로 25시간 후 자동 만료되도록 TTL 90000초 부여)
        await kv.put(ipKey, String(ipCount + 1), { expirationTtl: 90000 });
        await kv.put(devKey, String(devCount + 1), { expirationTtl: 90000 });
      } else {
        // 로컬 캐시 갱신
        localCache.set(ipKey, ipCount + 1);
        localCache.set(devKey, devCount + 1);
      }

      // 8. Claude API 호출 준비
      const apiKey = env.CLAUDE_API_KEY;
      if (!apiKey) {
        return new Response(
          JSON.stringify({ error: "서버 오류: 백엔드에 Claude API Key가 설정되지 않았습니다." }),
          {
            status: 500,
            headers: corsHeaders
          }
        );
      }

      // 시스템 프롬프트 및 사용자 입력값 구성
      const systemPrompt = `당신은 친절한 인생 코치 Nevi입니다. 과도한 동기부여 금지. 죄책감 유발 금지.
현실적인 다음 행동 3개를 추천합니다. 각 행동에 소요 시간(minutes)을 명시합니다.
행동은 10분 이내부터 시작합니다. mood가 막막함/지침이면 난이도를 낮춥니다.
prev_result가 있으면 참고해 다음 추천에 반영합니다.
반드시 아래 JSON만 출력합니다. 설명·인사·마크다운 없이.
{"title":"오늘의 다음 한 걸음","context":"1~2문장","actions":[{"text":"행동","minutes":10}]}`;

      const userMessage = `
[사용자 입력 정보]
- 목표 방향: ${direction}
- 관심사 분야: ${(interest || []).join(", ")}
- 실행 가능 시간: ${time}
- 현재 기분 상태: ${mood}
- 직전 시도 행동: ${prevResult || "없음"}
- 직전 행동 실패 사유: ${prevReason || "없음"}
`;

      // Claude API 호출 대행
      const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 1024,
          system: systemPrompt,
          messages: [
            { role: "user", content: userMessage }
          ]
        })
      });

      if (!anthropicResponse.ok) {
        const errorDetail = await anthropicResponse.text();
        throw new Error(`Claude API Error: ${anthropicResponse.status} - ${errorDetail}`);
      }

      const data = await anthropicResponse.json();
      const rawText = data.content[0].text.trim();
      
      // JSON 파싱 검증 및 클라이언트로 반환
      let cleanedJson = rawText;
      if (rawText.includes("```")) {
        cleanedJson = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
      }

      // JSON 구문 검사
      JSON.parse(cleanedJson);

      return new Response(cleanedJson, {
        status: 200,
        headers: corsHeaders
      });

    } catch (err) {
      return new Response(
        JSON.stringify({ error: `추천 엔진 오류: ${err.message}` }),
        {
          status: 500,
          headers: corsHeaders
        }
      );
    }
  }
};
