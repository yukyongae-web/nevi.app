# NEVI Cloudflare Worker 배포 가이드

본 문서는 작성된 `worker.js` 서버리스 프록시 코드를 Cloudflare Workers에 배포하고 설정하는 방법을 단계별로 안내합니다.

---

## 1. 사전 준비 (Wrangler CLI 설치)

Cloudflare Workers 배포 및 관리를 위한 커맨드라인 툴인 Wrangler를 설치하고 로그인합니다.

```bash
# 글로벌 또는 로컬 프로젝트에 wrangler 설치
npm install -g wrangler

# Cloudflare 계정 로그인 (브라우저가 열리면 승인)
wrangler login
```

---

## 2. KV 스토리지 생성 (Rate Limit 기록용)

사용자의 IP와 기기 ID를 날짜별로 트래킹하기 위해 Cloudflare KV(Key-Value) 네임스페이스를 생성합니다.

```bash
# 배포용 KV 네임스페이스 생성
wrangler kv:namespace create NEVI_LIMITS
```

위 명령어를 실행하면 터미널에 다음과 유사한 설정 결과가 출력됩니다.

```toml
[[kv_namespaces]]
binding = "NEVI_LIMITS"
id = "a1b2c3d4e5f6g7h8..."
```

출력된 `id` 값을 복사하여 본 프로젝트 폴더 안의 [wrangler.toml](file:///c:/my-app2-nevi/wrangler.toml) 파일 내용 중 `id = "your-kv-namespace-id-here"` 부분을 덮어씌웁니다.

---

## 3. Claude API Key 보안 설정 (환경 변수)

API 키는 소스 코드에 하드코딩하지 않고, Cloudflare Worker의 암호화된 환경 변수로 안전하게 등록합니다.

```bash
# 배포 환경에 CLAUDE_API_KEY 저장 (입력 창이 뜨면 sk- 로 시작하는 Claude API 키 입력)
wrangler secret put CLAUDE_API_KEY
```

> 💡 **로컬 개발 환경 테스트 시**:
> 로컬에서 실행할 때는 프로젝트 루트 폴더에 `.dev.vars` 파일을 생성하고 아래와 같이 채워 넣습니다:
> `CLAUDE_API_KEY="sk-ant-api..."`

---

## 4. 로컬 테스트 및 실시간 배포

### 로컬 개발 모드 실행
실제 배포하기 전에 로컬(컴퓨터)에서 Worker를 띄워 테스트합니다.
```bash
npx wrangler dev
```
- 로컬 실행 시 기본 주소는 `http://localhost:8787` 입니다.
- NEVI 앱 설정 탭에서 `http://localhost:8787` 주소를 입력하여 완벽하게 로컬 테스트가 가능합니다.

### Cloudflare 서버 배포
실제 클라우드 서버에 배포합니다.
```bash
npx wrangler deploy
```
- 배포가 완료되면 `https://nevi-worker.[사용자서브도메인].workers.dev` 형태의 고유 URL이 발급됩니다.

---

## 5. 앱 연동 및 확인

1. 배포된 Worker의 URL 주소를 복사합니다.
2. NEVI 앱의 하단 탭에서 **[설정] (⚙️)** 탭으로 이동합니다.
3. **[서버 연결 주소 (Worker URL)]** 입력란에 복사한 주소를 붙여넣고 **[서버 연결 주소 저장]** 버튼을 클릭합니다.
4. 이제 사용자는 API 키를 전혀 입력하지 않고도 바로 서비스를 이용할 수 있으며, 하루 3번의 질문 한도가 기기 ID와 IP를 기준으로 정확히 통제됩니다.
