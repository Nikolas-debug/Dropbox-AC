# Subida masiva a Dropbox — servicio de Railway

Sin dependencias: solo Node 18 o superior. Sirve la pagina y reparte el token.
Al estar la pagina y el token en el mismo origen, no hay CORS de por medio.

## Desplegar

1. Subir esta carpeta a un repositorio y crear el proyecto en Railway, o
   `railway up` desde aqui.
2. En Railway → Variables, poner:

   | Variable                 | Que es                                            |
   |--------------------------|---------------------------------------------------|
   | `DROPBOX_APP_KEY`        | App key de la app nueva (Full Dropbox)            |
   | `DROPBOX_APP_SECRET`     | su App secret                                     |
   | `DROPBOX_REFRESH_TOKEN`  | el refresh token (ver abajo)                      |
   | `SUBIDA_CLAVE`           | la clave con la que se entra a la pagina          |
   | `SUBIDA_USUARIO`         | opcional, por defecto `calidad`                   |
   | `CORS_ORIGEN`            | opcional: solo si sirve la pagina desde otro sitio |

   `SUBIDA_CLAVE` protege la pagina Y el token con la misma autenticacion
   del navegador. Antes habia un "secreto compartido" escrito en
   subida-config.js, lo cual no protegia nada: la pagina es publica, asi que
   cualquiera que la abriera leia el secreto. Ahora no hay ningun valor
   secreto en el repositorio.

3. Railway → Settings → Networking → Generate Domain.
4. Abrir el dominio. El navegador pedira usuario y clave; despues, pulsar
   Conectar.

No hay nada que editar: el servidor genera `/subida-config.js` al vuelo a
partir de las variables.

## El refresh token, una sola vez

1. Abrir en el navegador, con su App key:

       https://www.dropbox.com/oauth2/authorize?client_id=APP_KEY&response_type=code&token_access_type=offline

   El `token_access_type=offline` es lo que hace que Dropbox entregue un
   refresh token; sin eso solo da uno de acceso, que caduca en 4 horas.

2. Autorizar y copiar el codigo.

3. Canjearlo (el codigo se usa UNA vez y caduca rapido):

       curl https://api.dropboxapi.com/oauth2/token \
         -d code=EL_CODIGO \
         -d grant_type=authorization_code \
         -u APP_KEY:APP_SECRET

4. Copiar `refresh_token` a la variable de Railway.

## Comprobar que esta vivo

    GET  /salud     dice si estan puestas las variables (no revela ninguna)

## Al terminar

Borrar el servicio en Railway y revocar la app en Dropbox. El token muere con
el servicio.
