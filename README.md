# Tá Chovendo Aí?

Abra com **Live Server** (VS Code) ou em qualquer endereço **HTTPS**: a Geolocation API não funciona em `file://`.

- Clima: Open-Meteo (sem chave de API).
- Alertas estimados: calculados da previsão horária (24 h). Nunca chegam ao vermelho.
- Alertas oficiais: API pública de avisos do INMET (sem chave). O município é obtido com BigDataCloud (reverse geocoding, sem chave) apenas para casar o aviso com a sua área; coordenadas arredondadas a 2 casas.
- Se o INMET bloquear CORS no seu navegador/rede, o site avisa que não conseguiu verificar. Solução: um pequeno proxy próprio (ex.: Cloudflare Worker) e ajuste de `CONFIG.inmet` em `script.js`.
- Nada é gravado em localStorage/cookies; a localização fica só na memória da aba.


## Recursos adicionais

- Previsão diária para hoje, amanhã e depois de amanhã, com mínima, máxima, probabilidade e volume previsto de precipitação.
- Probabilidade e volume de chuva por hora nas próximas horas.
- Índice UV atual e recomendações de proteção solar.
- Indicador heurístico de condições favoráveis à atividade de mosquitos (temperatura, umidade e chuva prevista). Não é contagem de insetos nem avaliação epidemiológica.
- Indicação de trovoadas na previsão horária. Não é detecção de raios em tempo real; para isso seria necessária uma fonte específica de dados de descargas elétricas.
- Recomendação automática para praia, ficar em casa, tempo instável ou atenção a tempestades, baseada na previsão de amanhã e nos alertas oficiais vigentes.

Todos os dados meteorológicos adicionais são solicitados à API Open-Meteo. A disponibilidade de cada variável depende da resposta da API. Os indicadores estimados são identificados como estimativas e não substituem alertas oficiais.
