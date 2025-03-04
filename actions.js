module.exports = {
	// Create single Action/Feedback
	createAction: (instance, rcpCmd) => {
		const rcpNames = require('./rcpNames.json')
		const dProChoices = require('./dProChoices.json')
		const paramFuncs = require('./paramFuncs.js')

		let newAction = {}
		let paramsToAdd = []
		let actionName = rcpCmd.Address.slice(rcpCmd.Address.indexOf('/') + 1) // String after "MIXER:Current/"

		// Add the commands from the data file. Action id's (action.actionId) are the rcp command text (Address)
		let actionNameParts = actionName.split('/')
		let rcpNameIdx = actionName.startsWith('Cue') || actionName.startsWith('Meter') ? 1 : 0

		newAction = { name: actionName, options: [] }

		// X parameter - always an integer
		if (rcpCmd.X > 1) {
			let XOpts = {
				type: 'textinput',
				label: actionNameParts[rcpNameIdx],
				id: 'X',
				default: 1,
				required: true,
				useVariables: { local: true },
			}
			if (dProChoices[actionName] !== undefined) {
				XOpts = {
					...XOpts,
					type: 'dropdown',
					label: dProChoices[actionName].xName || actionNameParts[rcpNameIdx],
					minChoicesForSearch: 0,
					choices: dProChoices[actionName].X,
					allowCustom: true,
				}
			} else if (actionNameParts[rcpNameIdx].endsWith('Ch')) {
				XOpts = {
					...XOpts,
					type: 'dropdown',
					label: actionNameParts[rcpNameIdx],
					minChoicesForSearch: 0,
					choices: rcpNames.chNames.slice(0, parseInt(rcpCmd.X)),
					allowCustom: true,
				}
			}
			paramsToAdd.push(XOpts)
			rcpNameIdx++
		}

		// Y Parameter - always an integer
		if (rcpCmd.Y > 1) {
			if (actionNameParts[rcpNameIdx] == 'PEQ') {
				rcpNameIdx++
			}
			let YOpts = {
				type: 'textinput',
				label: actionNameParts[rcpNameIdx],
				id: 'Y',
				default: 1,
				required: true,
				useVariables: { local: true },
				allowCustom: true,
			}

			paramsToAdd.push(YOpts)
		}
		if (rcpNameIdx < actionNameParts.length - 1) {
			rcpNameIdx++
		}

		// Val Parameter - integer, freq, mtr, binary or string
		let ValOpts = {
			type: 'dropdown',
			label: actionNameParts[rcpNameIdx],
			id: 'Val',
			default: rcpCmd.Default,
			required: true,
			minChoicesForSearch: 0,
			allowCustom: true,
			useVariables: { local: true },
		}
		switch (rcpCmd.Type) {
			case 'bool':
				ValOpts = {
					...ValOpts,
					label: 'State',
					choices: [
						{ id: 1, label: 'On' },
						{ id: 0, label: 'Off' },
					],
				}
				if (rcpCmd.RW.includes('r')) {
					ValOpts.choices.push({ id: 'Toggle', label: 'Toggle' })
					ValOpts.default = 'Toggle'
				}
				paramsToAdd.push(ValOpts)
				break

			/* 			case 'mtr':
				ValOpts.label = 'Level' */

			case 'integer':
				//			case 'freq':
				if (rcpCmd.Max != 0 || rcpCmd.Min != 0) {
					if (dProChoices[actionName] !== undefined) {
						ValOpts.label = dProChoices[actionName].valName || actionNameParts[rcpNameIdx]
						ValOpts.choices = dProChoices[actionName].Val
						paramsToAdd.push(ValOpts)
					} else {
						ValOpts = {
							...ValOpts,
							type: 'textinput',
							default: rcpCmd.Default == -32768 ? '-Inf' : rcpCmd.Default / rcpCmd.Scale,
						}

						paramsToAdd.push(ValOpts)

						if (rcpCmd.RW.includes('r')) {
							paramsToAdd.push({
								type: 'checkbox',
								label: 'Relative',
								id: 'Rel',
								default: false,
							})
						}
					}
				}
				break

			case 'string':
			case 'binary':
				if (rcpNames[actionName] !== undefined) {
					ValOpts.choices = rcpNames[actionName]
				}
				paramsToAdd.push(ValOpts)
		}

		// Make sure the current value is stored in dataStore[]

		if (rcpCmd.Index < 1000 && rcpCmd.RW.includes('r')) {
			newAction.subscribe = async (action, context) => {
				let options = await paramFuncs.parseOptions(context, action.options)
				if (options != undefined) {
					let subscrAction = JSON.parse(JSON.stringify(options))
					subscrAction.Address = rcpCmd.Address
					instance.getFromDataStore(subscrAction) // Make sure current values are in dataStore
				}
			}
		}

		newAction.options.push(...paramsToAdd)

		return newAction
	},
	// Create the Actions & Feedbacks
	updateActions: (instance) => {
		const paramFuncs = require('./paramFuncs.js')
		const feedbackFuncs = require('./feedbacks.js')

		let commands = {}
		let feedbacks = {}
		let rcpCommand = {}
		let actionName = ''

		for (let i = 0; i < rcpCommands.length; i++) {
			rcpCommand = rcpCommands[i]
			actionName = rcpCommand.Address.replace(/:/g, '_') // Change the : to _ as companion doesn't like colons in names
			let newAction = module.exports.createAction(instance, rcpCommand)

			if (rcpCommand.RW.includes('r')) {
				feedbacks[actionName] = feedbackFuncs.createFeedbackFromAction(instance, newAction) // only include commands that can be read from the console
			}

			if (rcpCommand.RW.includes('w')) {
				newAction.callback = async (action, context) => {
					let foundCmd = paramFuncs.findRcpCmd(action.actionId) // Find which command
					let XArr = JSON.parse(await context.parseVariablesInString(action.options.X || 0))
					if (!Array.isArray(XArr)) {
						XArr = [XArr]
					}
					let YArr = JSON.parse(await context.parseVariablesInString(action.options.Y || 0))
					if (!Array.isArray(YArr)) {
						YArr = [YArr]
					}

					for (let X of XArr) {
						let opt = action.options
						for (let Y of YArr) {
							opt.X = X
							opt.Y = Y
							let options = await paramFuncs.parseOptions(context, opt)
							let actionCmd = options
							actionCmd.Address = foundCmd.Address
							actionCmd.prefix = 'set'
							instance.addToCmdQueue(actionCmd)
						}
					}
				}
				newAction.subscribe = async (action, context) => {
					let options = await paramFuncs.parseOptions(context, action.options)
					if (options != undefined) {
						let subscrAction = JSON.parse(JSON.stringify(options))
						const foundCmd = paramFuncs.findRcpCmd(action.actionId)
						subscrAction.Address = foundCmd.Address
						instance.getFromDataStore(subscrAction) // Make sure current values are in dataStore
					}
				}
				commands[actionName] = newAction // Only include commands that are writable to the console
			}
		}

		const { combineRgb } = require('@companion-module/base')

		instance.setActionDefinitions(commands)
		instance.setFeedbackDefinitions(feedbacks)
	},
}
