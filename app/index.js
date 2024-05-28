require('dotenv').config();

const axios = require('axios');

const axiosRetry = require('axios-retry').default;
axiosRetry(axios, { retries: 3, retryDelay: axiosRetry.exponentialDelay });

const fs = require('fs').promises;
const fsSync = require('fs');

const plexAddress = process.env.PLEX_ADDRESS;
const xPlexToken = process.env.X_PLEX_TOKEN;
const plexRootFolder = process.env.PLEX_ROOT_FOLDER.replace(/\/$/, ''); // remove trailing slash
const fileEndingPattern = process.env.FILE_ENDING_PATTERN;

const supportedMedia = ['movie', 'show']

const jsonOptions = {
    responseType: 'json'
};

const xmlOptions = {
    headers: {
        'Accept': 'application/xml'
    }
};

const imageOptions = {
    responseType: 'stream'
};

const urlFetchAllSections = () => `${plexAddress}/library/sections/all?X-Plex-Token=${xPlexToken}`;
const urlFetchSection = (section) => `${plexAddress}/library/sections/${section}/all?X-Plex-Token=${xPlexToken}`;
const urlFetchMetadata = (ratingKey) => `${plexAddress}/library/metadata/${ratingKey}?X-Plex-Token=${xPlexToken}`;
const urlFetchChildrenMetadata = (ratingKey) => `${plexAddress}/library/metadata/${ratingKey}/children?X-Plex-Token=${xPlexToken}`;
const urlFetchAsset = (imagePath) => `${plexAddress}${imagePath}?X-Plex-Token=${xPlexToken}`;

(async () => {
    console.log('-- Starting export at ' + new Date().toISOString());

    // fetch all library sections
    const librarySections = await fetchLibrary();

    let sectionCount = 0;

    // start export for every library
    for (const libraryDirectory of librarySections.MediaContainer.Directory) {
        console.log("Exporting section " + ++sectionCount + " of " + librarySections.MediaContainer.Directory.length + " - " + (Math.floor((sectionCount - 1) / librarySections.MediaContainer.Directory.length * 10000) / 100) + "% of the sections exported");

        if (!supportedMedia.includes(libraryDirectory.type)) {
            console.log("skipping " + libraryDirectory.title + " (" + libraryDirectory.type + ") unsupported type");
            continue
        }
        const librarySection = await fetchLibrarySection(libraryDirectory);
        const metaData = librarySection.MediaContainer.Metadata;

        let itemCount = 0;

        // export every item of a section
        for (const item of metaData) {
            ++itemCount
            if (itemCount>0 && (itemCount % 10) === 0) {
                console.log("progress " + itemCount + " of " + metaData.length + " - " + (Math.floor((itemCount - 1) / metaData.length * 10000) / 100) + "%");
            }

            switch (libraryDirectory.type) {
                case 'movie':
                    await fetchMovie(item.ratingKey);
                    break;
                case 'show':
                    await fetchShow(item.ratingKey);
                    break;
                default:
                    console.log(`Sorry, this media type is unsupported ${libraryDirectory.type}.`);
            }
        }
    }
}) ();

// fetches and writes libraries
async function fetchLibrary() {
    console.log('- Fetching library sections');

    try {
        const json = (await axios.get(urlFetchAllSections(), jsonOptions)).data;
        const xml = (await axios.get(urlFetchAllSections(), xmlOptions)).data;

        const mediaContainer = json.MediaContainer;

        console.log('Library Section: ' + mediaContainer.title1 + '(' + mediaContainer.viewGroup + ') with ' + mediaContainer.size + ' items');

        // write response to root-folder
        await fs.writeFile(plexRootFolder + "/" + mediaContainer.title1 + "-plex-library-" + fileEndingPattern + ".json", JSON.stringify(json));
        await fs.writeFile(plexRootFolder + "/" + mediaContainer.title1 + "-plex-library-" + fileEndingPattern + ".xml", JSON.stringify(xml));
        return json;

    } catch (error) {
        console.error('[ERROR] : ' + error);
        return null;
    }
}

// fetches and writes sections
async function fetchLibrarySection(libraryDirectory) {
    try {
        const json = (await axios.get(urlFetchSection(libraryDirectory.key), jsonOptions)).data;
        const xml = (await axios.get(urlFetchSection(libraryDirectory.key), xmlOptions)).data;

        const mediaContainer = json.MediaContainer;

        console.log('Library Section: ' + mediaContainer.title1 + '(' + + mediaContainer.size + ' items)');

        for (const location of libraryDirectory.Location) {
            await fs.writeFile(plexRootFolder + location.path + "/" + mediaContainer.title1 + "-plex-section-" + fileEndingPattern + ".json", JSON.stringify(json));
            await fs.writeFile(plexRootFolder + location.path + "/" + mediaContainer.title1 + "-plex-section-" + fileEndingPattern + ".xml", JSON.stringify(xml));
        }

        return json;
    } catch (error) {
        console.error('[ERROR] : ' + error);
        return null;
    }

    // try to fetch children for show - maybe unnecessary because empty shows will be removed from Plex
    try {
        const childrenJson = (await axios.get(urlFetchChildrenMetadata(item.ratingKey), jsonOptions)).data;
        

        for (const season of childrenJson.MediaContainer.Metadata) {
            await fetchSeason(season.ratingKey);
        }
    } catch (error) {
        // if children are not available, a 400 is returned by Plex
        if (error && error.response && error.response.status === 400) {
            console.error('**** Show does not have children: ' + item.title);
        } else {
            console.error('[ERROR] : ' + error);
        }
    }
}

// writes show data and fetches covers
async function fetchShow(ratingKey) {
    const json = (await axios.get(urlFetchMetadata(ratingKey), jsonOptions)).data;
    const xml = (await axios.get(urlFetchMetadata(ratingKey), xmlOptions)).data;


    for (const media of json.MediaContainer.Metadata) {
        console.log('   - ' + media.librarySectionTitle + ' | ' + media.title);

        const filePath = plexRootFolder + location.path + "/" + item.title + "-plex-show-item-" + fileEndingPattern;

        await fs.writeFile(filePath + ".json", JSON.stringify(json));
        await fs.writeFile(filePath + ".xml", JSON.stringify(xml));

        try {
            if ( typeof item.thumb !== 'undefined' && item.thumb ) {
                const thumbResponse = (await axios.get(urlFetchAsset(item.thumb), imageOptions)).data;
                thumbResponse.pipe(fsSync.createWriteStream(filePath + "-thumb.jpg"));
            }

            if ( typeof item.art !== 'undefined' && item.art ) {
                const artResponse = (await axios.get(urlFetchAsset(item.art), imageOptions)).data;
                artResponse.pipe(fsSync.createWriteStream(filePath + "-art.jpg"));
            }

            if ( typeof item.theme !== 'undefined' && item.theme ) {
                const artResponse = (await axios.get(urlFetchAsset(item.theme), imageOptions)).data;
                artResponse.pipe(fsSync.createWriteStream(filePath + "-theme.mp3"));
            }
        } catch (error) {
            console.error('[ERROR] : ' + error);
        }
    }

    // try to fetch children for show - maybe unnecessary because empty shows will be removed from Plex
    try {
        console.log('- ' + item.librarySectionTitle + ' | ' + item.title);

        const childrenJson = (await axios.get(createFetchChildrenMetaDataUrl(item.ratingKey), jsonOptions)).data;

        for (const season of childrenJson.MediaContainer.Metadata) {
            await fetchSeason(season.ratingKey);
        }
    } catch (error) {
        // if children are not available, a 400 is returned by Plex
        if (error && error.response && error.response.status === 400) {
            console.error('Show does not have children: ' + item.title);
        } else {
            console.error(error);
            throw error;
        }
    }
}

// writes season data and fetches covers
async function fetchSeason(ratingKey) {
    const json = (await axios.get(urlFetchMetadata(ratingKey), jsonOptions)).data;
    const xml = (await axios.get(urlFetchMetadata(ratingKey), xmlOptions)).data;


    for (const item of json.MediaContainer.Metadata) {
        // try to fetch children for season - maybe unnecessary because empty seasons will be removed from Plex
        try {
            console.log('  - ' + item.librarySectionTitle + ' | ' + item.parentTitle + ' - S' + item.index.toString().padStart(2, '0') + ' - ' + item.title);     

            const children = (await axios.get(urlFetchChildrenMetadata(item.ratingKey), jsonOptions)).data;

            let lastEpisodeParentFolderLocation = null;

            // TODO: currently, the folder structure is show -> season -> episode-file, but maybe a more elegant way would be
            //  to rename the whole library and build a structure like show -> season -> episode -> episode-file
            // at the moment, the season-cover and info is saved in the same folder as the first part of the last child-episode is located
            for (const episode of children.MediaContainer.Metadata) {
                const lastEpisodeLocation = await fetchEpisode(episode.ratingKey);

                lastEpisodeParentFolderLocation = plexRootFolder + lastEpisodeLocation.match(/^(.+)\/([^\/]+)$/)[1]; // remove the whole filename and the slash before
            }

            if (lastEpisodeParentFolderLocation !== null) {
                const filePath = lastEpisodeParentFolderLocation + "/" +
                  item.title + "-plex-season-item-" + fileEndingPattern;

                await fs.writeFile(filePath + ".json", JSON.stringify(json));
                await fs.writeFile(filePath + ".xml", JSON.stringify(xml));

                if ( typeof item.thumb !== 'undefined' && item.thumb ) {
                    const thumbResponse = (await axios.get(urlFetchAsset(item.thumb), imageOptions)).data;
                    thumbResponse.pipe(fsSync.createWriteStream(filePath + "-thumb.jpg"));
                }

                if ( typeof item.art !== 'undefined' && item.art ) {
                    const artResponse = (await axios.get(urlFetchAsset(item.art), imageOptions)).data;
                    artResponse.pipe(fsSync.createWriteStream(filePath + "-art.jpg"));
                }

            }
        } catch (error) {
            // if children are not available, a 400 is returned by Plex
            if (error && error.response && error.response.status === 400) {
                console.error('**** Season does not have children: ' + seasonItem.title);
            } else {
                console.error(error);
            }
        }
    }
}

// writes episode data and fetches covers
async function fetchEpisode(ratingKey) {
    const json = (await axios.get(urlFetchMetadata(ratingKey), jsonOptions)).data;
    const xml = (await axios.get(urlFetchMetadata(ratingKey), xmlOptions)).data;

    const item = json.MediaContainer.Metadata
    console.log('   - ' + item.librarySectionTitle + ' | ' + item.grandparentTitle + ' - S' + item.parentIndex.toString().padStart(2, '0') + 'E' + item.index.toString().padStart(2, '0') + ' - ' + item.title); 

    for (const media of item.Media) {
        for (const part of media.Part) {
            const filePathWithoutExtension = plexRootFolder + part.file.replace(/\.[^/.]+$/, ""); // removes file-extension
            const filePath = filePathWithoutExtension + "-plex-show-item-" + fileEndingPattern;

            await fs.writeFile(filePath + ".json", JSON.stringify(json));
            await fs.writeFile(filePath + ".xml", JSON.stringify(xml));

            try {
                if ( typeof item.thumb !== 'undefined' && item.thumb ) {
                    const thumbResponse = (await axios.get(urlFetchAsset(item.thumb), imageOptions)).data;
                    thumbResponse.pipe(fsSync.createWriteStream(filePath + "-thumb.jpg"));
                }

                if ( typeof item.art !== 'undefined' && item.art ) {
                    const artResponse = (await axios.get(urlFetchAsset(item.art), imageOptions)).data;
                    artResponse.pipe(fsSync.createWriteStream(filePath + "-art.jpg"));
                }

                if ( typeof item.theme !== 'undefined' && item.theme ) {
                    const artResponse = (await axios.get(urlFetchAsset(item.theme), imageOptions)).data;
                    artResponse.pipe(fsSync.createWriteStream(filePath + "-theme.mp3"));
                }
            } catch (error) {
                console.error('[ERROR] : ' + error);
            }
        }

        return metaData[metaData.length - 1].Media[0].Part[0].file;
    }
}

// writes a Plex item and fetches covers
async function fetchMovie(ratingKey) {

    const json = (await axios.get(urlFetchMetadata(ratingKey), jsonOptions)).data;
    const xml = (await axios.get(urlFetchMetadata(ratingKey), xmlOptions)).data;

    for (const item of json.MediaContainer.Metadata) {
        console.log('- ' + item.librarySectionTitle + ' | ' + item.title);

        for (const media of item.Media) {
            for (const part of media.Part) {
                const filePathWithoutExtension = plexRootFolder + part.file.replace(/\.[^/.]+$/, ""); // removes file-extension
                const filePath = filePathWithoutExtension + "-plex-movie-item-" + fileEndingPattern;

                await fs.writeFile(filePath + ".json", JSON.stringify(json));
                await fs.writeFile(filePath + ".xml", JSON.stringify(xml));

                try {
                    if ( typeof item.thumb !== 'undefined' && item.thumb ) {
                        const thumbResponse = (await axios.get(urlFetchAsset(item.thumb), imageOptions)).data;
                        thumbResponse.pipe(fsSync.createWriteStream(filePath + "-thumb.jpg"));
                    }

                    if ( typeof item.art !== 'undefined' && item.art ) {
                        const artResponse = (await axios.get(urlFetchAsset(item.art), imageOptions)).data;
                        artResponse.pipe(fsSync.createWriteStream(filePath + "-art.jpg"));
                    }

                    if ( typeof item.theme !== 'undefined' && item.theme ) {
                        const artResponse = (await axios.get(urlFetchAsset(item.theme), imageOptions)).data;
                        artResponse.pipe(fsSync.createWriteStream(filePath + "-theme.mp3"));
                    }
                } catch (error) {
                    console.error('[ERROR] : ' + error);
                }
            }
        }
    }
}
