# Kasuta ametlikku Node.js v18 baaskujutist
FROM node:18-slim

# Määra töökataloog konteineris
WORKDIR /usr/src/app

# Kopeeri package.json ja package-lock.json failid
# See samm kasutab ära Dockeri vahemälu, et sõltuvusi ei installitaks iga kord uuesti
COPY package*.json ./

# Installi rakenduse sõltuvused
RUN npm install

# Kopeeri ülejäänud rakenduse kood (server.js jms)
COPY . .

# Ava port, mida rakendus kuulama hakkab (Cloud Run ootab seda)
EXPOSE 8080

# Käivita rakendus, kui konteiner käivitub
CMD [ "node", "server.js" ]
