const { XMLParser, XMLBuilder, XMLValidator } = require("fast-xml-parser");
const fs = require('fs')
const path = require('path')

const sourceFile = 'Jumalauta Party 2025.qxw'
const targetFile = 'Jumalauta Party 2025.qxw'

const makeBackup = (filename) => {
    const basename = path.basename(filename, '.qxw')
    const date = new Date().toISOString()
    const backupName = `${basename} ${date}.qxw`

    fs.copyFileSync(filename, backupName)
}

const readQxw = (filename) => {
    const source = fs.readFileSync(filename)
    const parser = new XMLParser({ ignoreAttributes: false });
    return parser.parse(source);
}

const writeQxw = (filename, obj) => {
    const builder = new XMLBuilder({
        format: true,
        ignoreAttributes: false,
        suppressEmptyNode: true,
        suppressBooleanAttributes: false
    });
    const xmlContent = builder.build(obj).replace('<?xml version="1.0" encoding="UTF-8"?>', `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE Workspace>`)
    fs.writeFileSync(filename, xmlContent)
}


const attr = name => node => node[`@_${name}`]
const attrEquals = name => value => node => attr(name)(node) == value

const pathEquals = attrEquals("Path")
const captionEquals = attrEquals("Caption")
const getId = node => parseInt(attr("ID")(node))
const getName = attr("Name")
const isNotGenerated = node => attr("Path")(node) !== "Generated"

const ensureArr = a => Array.isArray(a) ? a : [a]
const partition = cond => ts => {
    const as = []
    const bs = []
    ts.forEach(t => (cond(t) ? as : bs).push(t))
    return [as, bs]
}
const groupBy = getKey => ts => {
    const r = {}
    ts.forEach(t => {
        const key = getKey(t)
        if (r[key]) {
            r[key].push(t)
        } else {
            r[key] = [t]
        }
    })
    return r
}
const splitBy = getKey => ts => Object.values(groupBy(getKey)(ts))

const head = as => as[0]
const second = as => as[1]

const counter = (prevId) => () => {
    prevId += 1
    return prevId
}

const getCombinations = (...arrays) => {
    if (arrays.length === 0) return []
    const [head, ...rest] = arrays
    if (rest.length === 0) return head
    const restCombs = getCombinations(...rest)
    return head.flatMap(a => restCombs.map(b => Array.isArray(b) ? [a, ...b] : [a, b]))
}

const buildCollection = (id, fns) => ({
    "@_ID": id,
    "@_Type": "Collection",
    "@_Name": fns.map(getName).map(name => {
        const [head, tail] = name.split(':')
        return (tail || head).trim()
    }).join(" "),
    "@_Path": "Generated",
    "Step": fns.map((f, i) => ({
        "#text": getId(f),
        "@_Number": i + 1
    }))
})

const getFxCombinations = (fns) => {
    const whiteFxFns = fns.filter(pathEquals('White fx'))
    const colorFxFns = fns.filter(pathEquals('Color fx'))
    const colorMaskFns = fns.filter(pathEquals('Color masks'))
    const motionMaskFns = fns.filter(pathEquals('Motion masks'))
    const lastId = Math.max(...fns.map(getId))

    console.log('White effects: ', whiteFxFns.length)
    console.log('Color effects: ', colorFxFns.length)
    console.log('Color masks:   ', colorMaskFns.length)
    console.log('Motion masks:  ', motionMaskFns.length)
    console.log('Last ID:       ', lastId)
    console.log()

    return [
        lastId,
        getCombinations(colorFxFns, motionMaskFns),
        getCombinations(whiteFxFns, motionMaskFns, colorMaskFns),
    ]
}

const updateFunctionsAndButtons = (allFns, virtualConsole) => {
    const fns = allFns.filter(isNotGenerated)

    const [lastFnId, multicolors, singleColors] = getFxCombinations(fns)

    // Generate new collections
    const nextFnId = counter(lastFnId)
    const newMulticolorCollections = multicolors.map((fns, i) => [fns, buildCollection(nextFnId(), fns)])
    const newSingleColorCollections = singleColors.map((fns, i) => [fns, buildCollection(nextFnId(), fns)])

    console.log("Number of multicolor collections:   ", newMulticolorCollections.length)
    console.log("Number of single color collections: ", newSingleColorCollections.length)

    const newFns = [
        ...newMulticolorCollections.map(second),
        ...newSingleColorCollections.map(second),

    ]

    const updatedFns = [...fns, ...newFns]

    // Generate buttons
    const soloFrames = ensureArr(virtualConsole.Frame.SoloFrame)
    const [[targetFrame, ...otherSoloFrames], otherSoloFrames2] = partition(captionEquals("Generated"))(soloFrames)

    const singleColorsByPage = splitBy(c => getId(c[0][2]))(newSingleColorCollections)

    targetFrame.Multipage = {
        "@_PagesNum": 1 + singleColorsByPage.length,
        "@_CurrentPage": 0
    }
    targetFrame.Shortcut = [
        createShortcut(0, "Multicolor"),
        ...singleColorsByPage.map((c, i) => createShortcut(i + 1, getName(c[0][0][2])))
    ]

    const nextBtnId = counter(0)
    const multicolorButtons = splitBy(c => getId(c[0][0]))(newMulticolorCollections)
        .flatMap((group, y) => group.map(([_, coll], x) => createButton(
            nextBtnId(),
            getId(coll),
            getName(coll),
            0,
            x,
            y
        )))

    const singleColorButtons = singleColorsByPage.flatMap((page, pageIndex) =>
        splitBy(c => getId(c[0][0]))(page)
            .flatMap((group, y) => group.map(([_, coll], x) => createButton(
                nextBtnId(),
                getId(coll),
                [...getName(coll).split(' ')].slice(0, -1).join(' '),
                pageIndex + 1,
                x,
                y
            )))
    )

    targetFrame.Button = [...multicolorButtons, ...singleColorButtons]
    const updatedSoloFrames = [targetFrame, ...otherSoloFrames, ...otherSoloFrames2]

    // Update speed dial
    const frames = ensureArr(virtualConsole.Frame.Frame)
    const [[globalFrame, ...otherFrames], otherFrames2] = partition(captionEquals("Global"))(frames)
    const speedDial = globalFrame.SpeedDial

    const generatedFnIds = newFns.map(getId)
    const currentFnIds = speedDial.Function.map(t => parseInt(t["#text"]))
    const missingFnIds = generatedFnIds.filter(id => currentFnIds.indexOf(id) === -1)

    missingFnIds.forEach(id => speedDial.Function.push({
        "#text": id,
        "@_FadeIn": 0,
        "@_FadeOut": 0,
        "@_FadeDuration": 6,
    }))

    const updatedFrames = [globalFrame, ...otherFrames, ...otherFrames2]

    return [updatedFns, updatedSoloFrames, updatedFrames]
}

const buttonSize = 100

const createButton = (id, fnId, caption, page, x, y) => ({
    WindowState: {
        '@_Visible': page === 0 ? 'True' : 'False',
        '@_X': 10 + buttonSize * x,
        '@_Y': 45 + buttonSize * y,
        '@_Width': buttonSize,
        '@_Height': buttonSize
    },
    Appearance: {
        FrameStyle: 'None',
        ForegroundColor: 'Default',
        BackgroundColor: 'Default',
        BackgroundImage: 'None',
        Font: 'Default'
    },
    Function: { '@_ID': fnId },
    Action: 'Toggle',
    Intensity: { '#text': 100, '@_Adjust': 'False' },
    '@_Caption': caption,
    '@_ID': id,
    '@_Icon': '',
    '@_Page': page

})

const createShortcut = (index, name) => ({
    "@_Page": index,
    "@_Name": name,
    "Key": {
        "#text": `${index + 1}`
    }
})

const main = () => {
    const data = readQxw(sourceFile)

    const [fns, soloFrames, frames] = updateFunctionsAndButtons(data.Workspace.Engine.Function, data.Workspace.VirtualConsole)

    data.Workspace.Engine.Function = fns
    data.Workspace.VirtualConsole.Frame.Frame = frames
    data.Workspace.VirtualConsole.Frame.SoloFrame = soloFrames

    if (sourceFile === targetFile) {
        makeBackup(targetFile)
    }

    writeQxw(targetFile, data)
}

main()

