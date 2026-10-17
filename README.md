# Tá Chovendo Aí?

Abra com **Live Server** (VS Code) ou em qualquer endereço **HTTPS**: a Geolocation API não funciona em `file://`.

- Clima: Open-Meteo (sem chave de API).
- Alertas estimados: calculados da previsão horária (24 h). Nunca chegam ao vermelho.
- Alertas oficiais: API pública de avisos do INMET (sem chave). O município é obtido com BigDataCloud (reverse geocoding, sem chave) apenas para casar o aviso com a sua área; coordenadas arredondadas a 2 casas.
- Se o INMET bloquear CORS no seu navegador/rede, o site avisa que não conseguiu verificar. Solução: um pequeno proxy próprio (ex.: Cloudflare Worker) e ajuste de `CONFIG.inmet` em `script.js`.
- Nada é gravado em localStorage/cookies; a localização fica só na memória da aba.
